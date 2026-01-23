const pool = require('../db/pool');
const { logAdminAction } = require('./audit.service');
const { queueSms } = require('../sms/sms.service');

const DOMAIN = 'teketeke';
const NOTIFY_COOLDOWN_MIN = Number(process.env.ALERT_NOTIFY_COOLDOWN_MINUTES || 30);
const ESCALATE_AFTER_MIN = Number(process.env.ALERT_ESCALATE_AFTER_MINUTES || 30);
const ESCALATE_REMIND_MIN = Number(process.env.ALERT_ESCALATE_REMIND_AFTER_MINUTES || 120);
const MAX_SUPER_RECIPIENTS = Number(process.env.MAX_SUPER_ALERT_RECIPIENTS || 3);
const DEFAULT_CHANNEL = (process.env.ALERT_NOTIFY_CHANNEL || '').toUpperCase() || (process.env.NODE_ENV === 'production' ? 'SMS' : 'CONSOLE');

function minutesAgo(minutes) {
  const now = new Date();
  return new Date(now.getTime() - minutes * 60 * 1000);
}

function formatAlertMessage(alert) {
  const sev = (alert?.severity || 'medium').toUpperCase();
  const type = alert?.type || 'ALERT';
  const summary = alert?.summary || '';
  const entity = alert?.entity_id ? ` (#${alert.entity_id})` : '';
  return `[${sev}] ${type}${entity}: ${summary}`.trim();
}

async function fetchSuperRecipients({ limit = MAX_SUPER_RECIPIENTS, db = pool }) {
  try {
    const { rows } = await db.query(
      `
        SELECT ur.user_id,
               LOWER(ur.role) AS role,
               sp.phone,
               sp.email,
               sp.name
        FROM user_roles ur
        LEFT JOIN staff_profiles sp ON sp.user_id = ur.user_id
        WHERE LOWER(ur.role) = 'super_admin'
        ORDER BY sp.updated_at DESC NULLS LAST, sp.created_at DESC NULLS LAST
        LIMIT $1
      `,
      [limit],
    );
    if (rows?.length) return rows;
  } catch (err) {
    console.warn('[alerts][recipients] failed to load super_admins from user_roles', err.message);
  }

  try {
    const { rows } = await db.query(
      `
        SELECT user_id, role, phone, email, name
        FROM staff_profiles
        WHERE LOWER(role) = 'super_admin'
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT $1
      `,
      [limit],
    );
    return rows || [];
  } catch (err) {
    console.warn('[alerts][recipients] failed to load from staff_profiles', err.message);
    return [];
  }
}

async function recordNotification({ alertId, channel, to, status, errorMessage = null, requestId = null, db = pool }) {
  try {
    await db.query(
      `
        INSERT INTO fraud_notifications (domain, alert_id, channel, "to", status, error_message, request_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [DOMAIN, alertId, channel, to, status, errorMessage, requestId || null],
    );
  } catch (err) {
    console.warn('[alerts][notify] failed to record notification', err.message);
  }
}

async function markNotified({ alertId, incrementBy = 1, when = new Date(), db = pool }) {
  const ts = when instanceof Date ? when.toISOString() : new Date(when || Date.now()).toISOString();
  await db.query(
    `
      UPDATE fraud_alerts
      SET last_notified_at = $2,
          notified_at = COALESCE(notified_at, $2),
          notified_count = COALESCE(notified_count, 0) + $3
      WHERE id = $1
    `,
    [alertId, ts, Math.max(incrementBy, 0)],
  );
}

async function notifyOnHighSeverity({
  alert,
  requestId = null,
  actorUserId = null,
  actorRole = null,
  db = pool,
}) {
  if (!alert || alert.severity !== 'high') {
    return { sent: false, reason: 'not_high' };
  }
  if (!alert.id) {
    return { sent: false, reason: 'missing_id' };
  }
  if (alert.status && alert.status !== 'open') {
    return { sent: false, reason: 'not_open' };
  }
  const now = new Date();
  const lastNotified = alert.last_notified_at ? new Date(alert.last_notified_at) : null;
  if (lastNotified && now.getTime() - lastNotified.getTime() < NOTIFY_COOLDOWN_MIN * 60 * 1000) {
    return { sent: false, reason: 'cooldown' };
  }

  const recipients = await fetchSuperRecipients({ db });
  if (!recipients.length) {
    console.warn('[alerts][notify] no super_admin recipients found');
    return { sent: false, reason: 'no_recipients' };
  }

  const channelPref = (process.env.ALERT_NOTIFY_CHANNEL || DEFAULT_CHANNEL || '').toUpperCase();
  const channel = channelPref === 'SMS' ? 'SMS' : channelPref === 'EMAIL' ? 'EMAIL' : 'CONSOLE';
  const body = formatAlertMessage(alert);
  let sentCount = 0;

  for (const r of recipients) {
    const toPhone = r.phone || r.msisdn || null;
    const to = channel === 'SMS' ? toPhone : r.email || r.user_id || 'console';
    if (channel === 'SMS' && !toPhone) {
      await recordNotification({ alertId: alert.id, channel, to: 'missing_phone', status: 'failed', errorMessage: 'no_phone', requestId, db });
      continue;
    }
    try {
      if (channel === 'SMS') {
        await queueSms({
          toPhone,
          templateCode: null,
          body,
          meta: { kind: 'fraud_alert', alert_id: alert.id, severity: alert.severity, type: alert.type },
        });
      } else {
        console.log('[alerts][notify]', body);
      }
      await recordNotification({ alertId: alert.id, channel, to, status: 'sent', requestId, db });
      sentCount += 1;
    } catch (err) {
      console.warn('[alerts][notify] failed', err.message || err);
      await recordNotification({
        alertId: alert.id,
        channel,
        to,
        status: 'failed',
        errorMessage: err.message || String(err),
        requestId,
        db,
      });
    }
  }

  if (sentCount > 0) {
    await markNotified({ alertId: alert.id, incrementBy: sentCount, when: now, db });
    await logAdminAction({
      req: { user: { id: actorUserId, role: actorRole }, requestId },
      action: 'fraud_alert_notify',
      resource_type: 'fraud_alert',
      resource_id: alert.id || alert.fingerprint || null,
      payload: { channel, sent: sentCount, severity: alert.severity, type: alert.type },
    });
  }

  return { sent: sentCount > 0, count: sentCount, channel };
}

async function maybeEscalateAndNotify({
  now = new Date(),
  actorUserId = null,
  actorRole = null,
  requestId = null,
  db = pool,
} = {}) {
  const medThreshold = minutesAgo(ESCALATE_AFTER_MIN);
  const remindThreshold = minutesAgo(ESCALATE_REMIND_MIN);
  let escalated = 0;
  let reminded = 0;
  let checked = 0;

  try {
    const { rows: medRows } = await db.query(
      `
        SELECT *
        FROM fraud_alerts
        WHERE domain = $1
          AND status = 'open'
          AND severity = 'medium'
          AND created_at <= $2
      `,
      [DOMAIN, medThreshold.toISOString()],
    );
    checked += medRows?.length || 0;
    for (const row of medRows || []) {
      await db.query(`UPDATE fraud_alerts SET severity = 'high' WHERE id = $1`, [row.id]);
      escalated += 1;
      await logAdminAction({
        req: { user: { id: actorUserId, role: actorRole }, requestId },
        action: 'fraud_alert_escalated',
        resource_type: 'fraud_alert',
        resource_id: row.id,
        payload: { from: 'medium', reason: 'age', created_at: row.created_at },
      });
      await notifyOnHighSeverity({
        alert: { ...row, severity: 'high' },
        requestId,
        actorUserId,
        actorRole,
        db,
      });
    }
  } catch (err) {
    console.warn('[alerts][escalate] failed to escalate mediums', err.message);
  }

  try {
    const { rows: highRows } = await db.query(
      `
        SELECT *
        FROM fraud_alerts
        WHERE domain = $1
          AND status = 'open'
          AND severity = 'high'
          AND (last_notified_at IS NULL OR last_notified_at <= $2)
      `,
      [DOMAIN, remindThreshold.toISOString()],
    );
    checked += highRows?.length || 0;
    for (const row of highRows || []) {
      const res = await notifyOnHighSeverity({
        alert: row,
        requestId,
        actorUserId,
        actorRole,
        db,
      });
      if (res.sent) reminded += 1;
    }
  } catch (err) {
    console.warn('[alerts][escalate] failed to process reminders', err.message);
  }

  await logAdminAction({
    req: { user: { id: actorUserId, role: actorRole }, requestId },
    action: 'fraud_alert_escalation_run',
    resource_type: 'fraud_alert',
    resource_id: requestId || 'manual',
    payload: { escalated, reminded, checked },
  });

  return { escalated, reminded, checked };
}

module.exports = {
  formatAlertMessage,
  notifyOnHighSeverity,
  maybeEscalateAndNotify,
  fetchSuperRecipients,
};
