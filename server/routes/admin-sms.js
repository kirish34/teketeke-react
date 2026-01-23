const express = require('express');
const router = express.Router();
const pool = process.env.NODE_ENV === 'test' && global.__testPool ? global.__testPool : require('../db/pool');
const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const { logAdminAction } = require('../services/audit.service');

router.use(requireSystemOrSuper);

const SMS_SETTING_FIELDS = [
  'sender_id',
  'quiet_hours_start',
  'quiet_hours_end',
  'fee_paid_enabled',
  'fee_failed_enabled',
  'balance_enabled',
  'eod_enabled',
  'payout_paid_enabled',
  'payout_failed_enabled',
  'savings_paid_enabled',
  'savings_balance_enabled',
  'loan_paid_enabled',
  'loan_failed_enabled',
  'loan_balance_enabled',
];

const SMS_SETTING_BOOLEAN_FIELDS = new Set([
  'fee_paid_enabled',
  'fee_failed_enabled',
  'balance_enabled',
  'eod_enabled',
  'payout_paid_enabled',
  'payout_failed_enabled',
  'savings_paid_enabled',
  'savings_balance_enabled',
  'loan_paid_enabled',
  'loan_failed_enabled',
  'loan_balance_enabled',
]);

function parseBooleanInput(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const norm = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(norm)) return true;
    if (['false', '0', 'no', 'off', ''].includes(norm)) return false;
  }
  return false;
}

function pickSmsSettings(input) {
  const out = {};
  const body = input || {};
  SMS_SETTING_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const raw = body[field];
      if (SMS_SETTING_BOOLEAN_FIELDS.has(field)) {
        out[field] = parseBooleanInput(raw);
      } else if (raw === null || raw === undefined) {
        out[field] = null;
      } else {
        const text = String(raw).trim();
        out[field] = text ? text : null;
      }
    }
  });
  return out;
}

async function logSmsAction(req, action, resourceId = null, payload = null) {
  try {
    await logAdminAction({
      req,
      action,
      resource_type: 'sms',
      resource_id: resourceId,
      payload,
    });
  } catch {
    // best-effort audit log
  }
}

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

router.get('/sms/settings', async (_req, res) => {
  try {
    await pool.query(`insert into sms_settings (id) values (1) on conflict (id) do nothing`);
    const { rows } = await pool.query(`select * from sms_settings where id = 1 limit 1`);
    res.json({ ok: true, settings: rows[0] || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/sms/settings', async (req, res) => {
  const updates = pickSmsSettings(req.body);
  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ ok: false, error: 'no fields to update' });
  const values = keys.map((k) => updates[k]);
  const setClause = keys.map((k) => `${k} = excluded.${k}`).join(', ');
  const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
  const sql = `
    insert into sms_settings (id, ${keys.join(', ')})
    values (1, ${placeholders})
    on conflict (id) do update
    set ${setClause},
        updated_at = now()
    returning *
  `;
  try {
    const { rows } = await pool.query(sql, values);
    await logSmsAction(req, 'sms_settings_update', 'settings', updates);
    res.json({ ok: true, settings: rows[0] || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/sms/templates', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
        select code, label, body, is_active, updated_at
        from sms_templates
        order by code
      `
    );
    res.json({ ok: true, items: rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/sms/templates/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!code) return res.status(400).json({ ok: false, error: 'code required' });
  const hasBody = Object.prototype.hasOwnProperty.call(req.body || {}, 'body');
  const hasLabel = Object.prototype.hasOwnProperty.call(req.body || {}, 'label');
  const hasActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasBody && !hasLabel && !hasActive) {
    return res.status(400).json({ ok: false, error: 'body, label, or is_active required' });
  }
  const label = hasLabel ? String(req.body.label || '').trim() : null;
  const body = hasBody ? String(req.body.body || '').trim() : null;
  const isActive = hasActive ? parseBooleanInput(req.body.is_active) : null;
  try {
    const { rows } = await pool.query(
      `
        insert into sms_templates (code, label, body, is_active, updated_at)
        values ($1, $2, $3, $4, now())
        on conflict (code) do update
        set label = coalesce(excluded.label, sms_templates.label),
            body = coalesce(excluded.body, sms_templates.body),
            is_active = coalesce(excluded.is_active, sms_templates.is_active),
            updated_at = now()
        returning code, label, body, is_active, updated_at
      `,
      [code, label, body, isActive]
    );
    await logSmsAction(req, 'sms_template_upsert', code, { label, isActive });
    res.json({ ok: true, template: rows[0] || null });
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
    await logSmsAction(req, 'sms_retry', id, { status: rows[0]?.status || 'PENDING' });
    res.json({ ok: true, sms: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
