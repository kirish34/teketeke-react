const pool = require('../db/pool');

const TEMPLATE_SETTING_MAP = {
  fee_paid: 'fee_paid_enabled',
  fee_failed: 'fee_failed_enabled',
  balance_request: 'balance_enabled',
  eod_summary: 'eod_enabled',
  payout_paid: 'payout_paid_enabled',
  payout_failed: 'payout_failed_enabled',
  savings_paid: 'savings_paid_enabled',
  savings_balance: 'savings_balance_enabled',
  loan_paid: 'loan_paid_enabled',
  loan_failed: 'loan_failed_enabled',
  loan_balance: 'loan_balance_enabled',
};

function renderTemplateString(body, data = {}) {
  return body.replace(/{{\s*([\w.]+)\s*}}/g, (_m, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

async function renderTemplate(code, data) {
  const res = await pool.query(
    `select body, is_active from sms_templates where code = $1 limit 1`,
    [code]
  );
  if (!res.rows.length) throw new Error(`SMS template not found: ${code}`);
  if (res.rows[0].is_active === false) return null;
  return renderTemplateString(res.rows[0].body, data);
}

async function queueSms({ toPhone, templateCode = null, body, meta = {} }) {
  if (!toPhone) throw new Error('toPhone is required');
  if (!body) throw new Error('body is required');

  const result = await pool.query(
    `
      insert into sms_messages (to_phone, template_code, body, meta)
      values ($1, $2, $3, $4)
      returning id, status, created_at
    `,
    [toPhone, templateCode, body, meta]
  );

  return result.rows[0];
}

async function getSmsSettings() {
  try {
    const res = await pool.query(`select * from sms_settings where id = 1 limit 1`);
    return res.rows[0] || null;
  } catch (err) {
    return null;
  }
}

function parseClock(value) {
  if (!value) return null;
  const parts = String(value).trim().split(':');
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isWithinQuietHours(now, start, end) {
  if (start === null || end === null) return false;
  if (start === end) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

async function queueTemplatedSms({ toPhone, templateCode, data = {}, meta = {} }) {
  if (!templateCode) throw new Error('templateCode is required');
  const settings = await getSmsSettings();
  if (settings) {
    const settingKey = TEMPLATE_SETTING_MAP[templateCode];
    if (settingKey && settings[settingKey] === false) {
      return { skipped: true, reason: 'disabled' };
    }
    if (!meta.allow_quiet_hours) {
      const start = parseClock(settings.quiet_hours_start);
      const end = parseClock(settings.quiet_hours_end);
      if (isWithinQuietHours(new Date(), start, end)) {
        return { skipped: true, reason: 'quiet_hours' };
      }
    }
  }
  const renderedBody = await renderTemplate(templateCode, data);
  if (!renderedBody) {
    return { skipped: true, reason: 'inactive' };
  }
  const mergedMeta = { ...meta };
  if (settings?.sender_id) {
    mergedMeta.sender_id = settings.sender_id;
  }
  return queueSms({ toPhone, templateCode, body: renderedBody, meta: mergedMeta });
}

module.exports = {
  renderTemplateString,
  renderTemplate,
  queueSms,
  queueTemplatedSms,
};
