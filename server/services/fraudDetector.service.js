const pool = require('../db/pool');
const { logAdminAction } = require('./audit.service');
const { parseRange } = require('./monitoring.service'); // reuse range parsing
const { notifyOnHighSeverity } = require('./alertRouting.service');

const DOMAIN = 'teketeke';
const BURST_THRESHOLD = Number(process.env.FRAUD_BURST_THRESHOLD || 20);
const BURST_WINDOW_MIN = Number(process.env.FRAUD_BURST_WINDOW_MIN || 5);
const PAYOUT_FAILURE_THRESHOLD = Number(process.env.FRAUD_PAYOUT_FAIL_THRESHOLD || 5);
const PAYOUT_FAILURE_WINDOW_MIN = Number(process.env.FRAUD_PAYOUT_FAIL_WINDOW_MIN || 10);
const RECON_EX_THRESHOLD = Number(process.env.FRAUD_RECON_EX_THRESHOLD || 30);
const RECON_EX_WINDOW_MIN = Number(process.env.FRAUD_RECON_EX_WINDOW_MIN || 60);

function windowBucket(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'invalid';
  const bucket = date.toISOString().slice(0, 16); // minute precision
  return bucket;
}

async function upsertAlert({
  type,
  severity = 'medium',
  entity_type,
  entity_id,
  window_from,
  window_to,
  fingerprint,
  summary,
  details,
  db = pool,
}) {
  if (!fingerprint) return { inserted: false, alert: null };
  const insertedRes = await db.query(
    `
      INSERT INTO fraud_alerts
        (domain, type, severity, status, entity_type, entity_id, window_from, window_to, fingerprint, summary, details)
      VALUES
        ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (domain, fingerprint) DO NOTHING
      RETURNING *
    `,
    [
      DOMAIN,
      type,
      severity,
      entity_type || null,
      entity_id || null,
      window_from || null,
      window_to || null,
      fingerprint,
      summary,
      details || {},
    ],
  );
  if (insertedRes.rows?.length) {
    return { inserted: true, alert: insertedRes.rows[0] };
  }
  const { rows } = await db.query(
    `
      SELECT *
      FROM fraud_alerts
      WHERE domain = $1 AND fingerprint = $2
      LIMIT 1
    `,
    [DOMAIN, fingerprint],
  );
  return { inserted: false, alert: rows?.[0] || null };
}

async function detectDuplicateAttempts({ from, to, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const res = await db.query(
    `
      SELECT COALESCE(resource_type, entity_type) AS kind,
             COALESCE(resource_id, entity_id) AS provider_ref,
             COUNT(*)::int AS count,
             MIN(created_at) AS first_at,
             MAX(created_at) AS last_at
      FROM admin_audit_logs
      WHERE domain = $1
        AND action = 'mpesa_callback'
        AND COALESCE(result, meta->>'result') = 'duplicate'
        AND created_at BETWEEN $2 AND $3
      GROUP BY kind, provider_ref
      HAVING COUNT(*) >= 2
    `,
    [DOMAIN, fromTs.toISOString(), toTs.toISOString()],
  );
  const alerts = [];
  for (const row of res.rows || []) {
    const fp = `dup:${row.kind || 'cb'}:${row.provider_ref || 'n/a'}:${windowBucket(row.last_at)}`;
    alerts.push({
      type: 'DUPLICATE_ATTEMPT',
      severity: 'medium',
      entity_type: 'CALLBACK',
      entity_id: row.provider_ref || null,
      window_from: row.first_at,
      window_to: row.last_at,
      fingerprint: fp,
      summary: `Duplicate callback attempts for ${row.kind || 'callback'} ${row.provider_ref || ''}`,
      details: { count: row.count },
    });
  }
  return alerts;
}

async function detectBurstCallbacks({ db = pool } = {}) {
  const to = new Date();
  const from = new Date(to.getTime() - BURST_WINDOW_MIN * 60 * 1000);
  const res = await db.query(
    `
      SELECT
        COALESCE(payload->>'msisdn', payload->>'phone', payload->>'ip', payload->>'device_id') AS key,
        COUNT(*)::int AS count,
        MIN(created_at) AS first_at,
        MAX(created_at) AS last_at
      FROM admin_audit_logs
      WHERE domain = $1
        AND action = 'mpesa_callback'
        AND created_at BETWEEN $2 AND $3
      GROUP BY key
      HAVING COUNT(*) >= $4
    `,
    [DOMAIN, from.toISOString(), to.toISOString(), BURST_THRESHOLD],
  );
  const alerts = [];
  for (const row of res.rows || []) {
    const key = row.key || 'unknown';
    const fp = `burst:${key}:${windowBucket(row.last_at)}`;
    alerts.push({
      type: 'BURST_CALLBACKS',
      severity: 'high',
      entity_type: 'MSISDN',
      entity_id: key,
      window_from: row.first_at,
      window_to: row.last_at,
      fingerprint: fp,
      summary: `Burst callbacks detected for ${key}`,
      details: { count: row.count },
    });
  }
  return alerts;
}

async function detectAmountMismatch({ from, to, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const res = await db.query(
    `
      SELECT provider_ref, amount, internal_ref, details, created_at
      FROM recon_items
      WHERE status = 'mismatch_amount'
        AND created_at BETWEEN $1 AND $2
    `,
    [fromTs.toISOString(), toTs.toISOString()],
  );
  return (res.rows || []).map((row) => ({
    type: 'AMOUNT_MISMATCH',
    severity: 'medium',
    entity_type: 'CALLBACK',
    entity_id: row.provider_ref || null,
    window_from: row.created_at,
    window_to: row.created_at,
    fingerprint: `mismatch:${row.provider_ref}`,
    summary: `Amount mismatch for provider ref ${row.provider_ref}`,
    details: { amount: row.amount, internal_ref: row.internal_ref, details: row.details || {} },
  }));
}

async function detectPayoutFailureSpike({ db = pool } = {}) {
  const to = new Date();
  const from = new Date(to.getTime() - PAYOUT_FAILURE_WINDOW_MIN * 60 * 1000);
  const res = await db.query(
    `
      SELECT destination_ref AS key, COUNT(*)::int AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
      FROM payout_items
      WHERE status = 'FAILED'
        AND created_at BETWEEN $1 AND $2
      GROUP BY destination_ref
      HAVING COUNT(*) >= $3
    `,
    [from.toISOString(), to.toISOString(), PAYOUT_FAILURE_THRESHOLD],
  );
  return (res.rows || []).map((row) => ({
    type: 'PAYOUT_FAILURE_SPIKE',
    severity: 'high',
    entity_type: 'PAYOUT_DEST',
    entity_id: row.key || null,
    window_from: row.first_at,
    window_to: row.last_at,
    fingerprint: `payoutfail:${row.key || 'unknown'}:${windowBucket(row.last_at)}`,
    summary: `Payout failures spiking for destination ${row.key || 'unknown'}`,
    details: { count: row.count },
  }));
}

async function detectReconExceptionSpike({ db = pool } = {}) {
  const to = new Date();
  const from = new Date(to.getTime() - RECON_EX_WINDOW_MIN * 60 * 1000);
  const res = await db.query(
    `
      SELECT COUNT(*)::int AS count
      FROM recon_items
      WHERE status IN ('missing_internal','unmatched','mismatch_amount')
        AND created_at BETWEEN $1 AND $2
    `,
    [from.toISOString(), to.toISOString()],
  );
  const count = res.rows?.[0]?.count || 0;
  if (count >= RECON_EX_THRESHOLD) {
    const fp = `recon:${windowBucket(to.toISOString())}`;
    return [
      {
        type: 'RECON_EXCEPTIONS_SPIKE',
        severity: 'medium',
        entity_type: 'RECON',
        entity_id: null,
        window_from: from.toISOString(),
        window_to: to.toISOString(),
        fingerprint: fp,
        summary: `Recon exceptions spike (${count} in window)`,
        details: { count },
      },
    ];
  }
  return [];
}

async function runFraudDetection({
  fromTs,
  toTs,
  actorUserId = null,
  actorRole = null,
  requestId = null,
  mode = 'write',
  db = pool,
}) {
  const dryRun = mode === 'dry';
  const from = fromTs || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const to = toTs || new Date().toISOString();

  const [dupAlerts, burstAlerts, mismatchAlerts, payoutAlerts, reconAlerts] = await Promise.all([
    detectDuplicateAttempts({ from, to, db }),
    detectBurstCallbacks({ db }),
    detectAmountMismatch({ from, to, db }),
    detectPayoutFailureSpike({ db }),
    detectReconExceptionSpike({ db }),
  ]);

  const allAlerts = [...dupAlerts, ...burstAlerts, ...mismatchAlerts, ...payoutAlerts, ...reconAlerts];
  let created = 0;

  if (!dryRun) {
    for (const alert of allAlerts) {
      const res = await upsertAlert({ ...alert, db });
      if (res.inserted) created += 1;
      const targetAlert = res.alert || alert;
      if (targetAlert?.severity === 'high') {
        await notifyOnHighSeverity({
          alert: { ...alert, ...targetAlert },
          requestId,
          actorUserId,
          actorRole,
          db,
        });
      }
    }
    await logAdminAction({
      req: { user: { id: actorUserId, role: actorRole }, requestId },
      action: 'fraud_detector_completed',
      resource_type: 'fraud_detector',
      resource_id: `${from}_${to}`,
      payload: { created },
    });
  } else {
    await logAdminAction({
      req: { user: { id: actorUserId, role: actorRole }, requestId },
      action: 'fraud_detector_dry',
      resource_type: 'fraud_detector',
      resource_id: `${from}_${to}`,
      payload: { count: allAlerts.length },
    });
  }

  return { totals: { alerts: allAlerts.length }, alerts_created: created, alerts: allAlerts };
}

module.exports = {
  runFraudDetection,
  detectDuplicateAttempts,
  detectBurstCallbacks,
  detectAmountMismatch,
  detectPayoutFailureSpike,
  detectReconExceptionSpike,
};
