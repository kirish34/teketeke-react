const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdminAccess } = require('../middleware/admin-access');

router.use(requireAdminAccess);

// List SMS messages with optional status filter
router.get('/sms', async (req, res) => {
  const status = (req.query.status || '').toUpperCase();
  const params = [];
  let where = '1=1';
  if (status) {
    params.push(status);
    where = 'status = $1';
  }
  try {
    const { rows } = await pool.query(
      `
        SELECT id, to_phone, template_code, body, status, provider_message_id, error_message, tries, meta,
               created_at, updated_at
        FROM sms_messages
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 200
      `,
      params
    );
    res.json({ ok: true, items: rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Retry/force PENDING
router.post('/sms/:id/retry', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rows } = await pool.query(
      `
        UPDATE sms_messages
        SET status = 'PENDING',
            error_message = null,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, sms: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
