const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireSystemOrSuper, requireSuperOnly } = require('../middleware/requireAdmin');
const { releaseOperation, cancelQuarantine } = require('../services/quarantine.service');

router.use(requireSystemOrSuper);

router.get('/quarantine', async (req, res) => {
  const status = (req.query.status || 'quarantined').toLowerCase();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  try {
    const { rows } = await pool.query(
      `
        SELECT *
        FROM quarantined_operations
        WHERE status = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [status, limit],
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/quarantine/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rows } = await pool.query(
      `
        SELECT *
        FROM quarantined_operations
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
    const alertId = rows[0]?.alert_id || null;
    let alert = null;
    if (alertId) {
      const ares = await pool.query(`SELECT id, severity, status, summary FROM fraud_alerts WHERE id = $1`, [alertId]);
      alert = ares.rows?.[0] || null;
    }
    return res.json({ ok: true, record: rows[0], alert });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/quarantine/:id/release', requireSuperOnly, async (req, res) => {
  const id = req.params.id;
  const note = req.body?.note || null;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  if (!note) return res.status(400).json({ ok: false, error: 'note required' });
  try {
    const record = await releaseOperation({
      id,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || null,
      note,
      resume: true,
      db: pool,
    });
    return res.json({ ok: true, record });
  } catch (err) {
    const code = err.message === 'not_found_or_not_quarantined' ? 404 : 500;
    return res.status(code).json({ ok: false, error: err.message });
  }
});

router.post('/quarantine/:id/cancel', requireSuperOnly, async (req, res) => {
  const id = req.params.id;
  const note = req.body?.note || null;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const record = await cancelQuarantine({
      id,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || null,
      note,
      db: pool,
    });
    return res.json({ ok: true, record });
  } catch (err) {
    const code = err.message === 'not_found_or_not_quarantined' ? 404 : 500;
    return res.status(code).json({ ok: false, error: err.message });
  }
});

module.exports = router;
