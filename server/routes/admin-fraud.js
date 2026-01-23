const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireSystemOrSuper, requireSuperOnly } = require('../middleware/requireAdmin');
const { runFraudDetection } = require('../services/fraudDetector.service');
const { isQueueEnabled, enqueueJob } = require('../queues/queue');
const { logAdminAction } = require('../services/audit.service');
const { maybeEscalateAndNotify } = require('../services/alertRouting.service');

router.use(requireSystemOrSuper);

router.post('/fraud/run', async (req, res) => {
  const from = req.body?.from || req.query?.from || null;
  const to = req.body?.to || req.query?.to || null;
  const mode = req.body?.mode === 'dry' ? 'dry' : 'write';
  try {
    if (isQueueEnabled() && mode === 'write') {
      const job = await enqueueJob(
        'FRAUD_DETECTOR_RUN',
        { from, to, actorUserId: req.user?.id || null, actorRole: req.user?.role || null },
        { jobId: `fraud:${from || 'auto'}:${to || 'now'}` },
      );
      await logAdminAction({
        req,
        action: 'fraud_detector_enqueued',
        resource_type: 'fraud_detector',
        resource_id: job.id,
        payload: { from, to },
      });
      return res.status(202).json({ ok: true, job_id: job.id, queued: true });
    }
    const result = await runFraudDetection({
      fromTs: from,
      toTs: to,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || null,
      requestId: req.requestId || null,
      mode,
    });
    return res.json({ ok: true, ...result, queued: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/fraud/alerts', async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  const status = String(req.query.status || '').trim();
  const type = String(req.query.type || '').trim();
  const severity = String(req.query.severity || '').trim();

  const where = [`domain = 'teketeke'`];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (type) {
    params.push(type);
    where.push(`type = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    where.push(`severity = $${params.length}`);
  }
  params.push(limit);
  params.push(offset);
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `
        SELECT *
        FROM fraud_alerts
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params,
    );
    return res.json({ ok: true, items: rows || [], limit, offset });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/fraud/alerts/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rows } = await pool.query(
      `
        SELECT *
        FROM fraud_alerts
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, alert: rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/fraud/alerts/:id/assign', async (req, res) => {
  const id = req.params.id;
  const assignedTo = Object.prototype.hasOwnProperty.call(req.body || {}, 'assigned_to')
    ? req.body.assigned_to
    : req.body?.assignedTo;
  const note = req.body?.note || req.body?.assigned_note || null;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  if (typeof assignedTo === 'undefined') return res.status(400).json({ ok: false, error: 'assigned_to required' });
  try {
    await pool.query(
      `
        UPDATE fraud_alerts
        SET assigned_to = $2,
            assigned_note = COALESCE($3, assigned_note)
        WHERE id = $1
      `,
      [id, assignedTo || null, note || null],
    );
    await logAdminAction({
      req,
      action: 'fraud_alert_assigned',
      resource_type: 'fraud_alert',
      resource_id: id,
      payload: { assigned_to: assignedTo || null, note: note || null },
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/fraud/alerts/:id/status', async (req, res) => {
  const id = req.params.id;
  const status = String(req.body?.status || '').trim().toLowerCase();
  const note = req.body?.note || null;
  if (!id || !status) return res.status(400).json({ ok: false, error: 'id and status required' });
  const allowed = new Set(['investigating', 'resolved', 'false_positive', 'open']);
  if (!allowed.has(status)) return res.status(400).json({ ok: false, error: 'invalid status' });
  if (status === 'open' && (req.user?.role || '').toLowerCase() !== 'super_admin') {
    return res.status(403).json({ ok: false, error: 'only super_admin can reopen alerts' });
  }
  try {
    const resolvedAt = ['resolved', 'false_positive'].includes(status) ? new Date().toISOString() : null;
    await pool.query(
      `
        UPDATE fraud_alerts
        SET status = $2,
            resolved_at = COALESCE($3, resolved_at),
            resolved_by = CASE WHEN $3 IS NOT NULL THEN $4 ELSE resolved_by END,
            resolution_note = COALESCE($5, resolution_note)
        WHERE id = $1
      `,
      [id, status, resolvedAt, req.user?.id || null, note || null],
    );
    await logAdminAction({
      req,
      action: 'fraud_alert_status',
      resource_type: 'fraud_alert',
      resource_id: id,
      payload: { status, note: note || null },
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/fraud/escalate/run', async (req, res) => {
  try {
    if (isQueueEnabled()) {
      const job = await enqueueJob(
        'FRAUD_ALERT_ESCALATION',
        { actorUserId: req.user?.id || null, actorRole: req.user?.role || null },
        { jobId: `fraud-escalate-${Date.now()}` },
      );
      await logAdminAction({
        req,
        action: 'fraud_escalate_enqueued',
        resource_type: 'fraud_alert',
        resource_id: job.id,
        payload: {},
      });
      return res.status(202).json({ ok: true, job_id: job.id, queued: true });
    }
    const result = await maybeEscalateAndNotify({
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || null,
      requestId: req.requestId || null,
      db: pool,
    });
    return res.json({ ok: true, queued: false, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
