const pool = require('../db/pool');
const { normalizeRef } = require('../wallet/wallet.aliases');
const { createOpsAlert } = require('../services/opsAlerts.service');

const DEFAULT_LARGE_AMOUNT = Number(process.env.C2B_RISK_LARGE_AMOUNT || 5000);
const RAPID_FIRE_WINDOW_SEC = Number(process.env.C2B_RISK_RAPID_FIRE_WINDOW_SEC || 120);
const RAPID_FIRE_THRESHOLD = Number(process.env.C2B_RISK_RAPID_FIRE_COUNT || 3);
const MULTI_ALIAS_THRESHOLD = Number(process.env.C2B_RISK_MULTI_ALIAS_COUNT || 2);

const REASON_SCORE = {
  PAYBILL_MISMATCH: 80,
  INVALID_MANUAL_ACCOUNT_REF: 50,
  INVALID_CHECKSUM_REF: 50,
  UNKNOWN_ACCOUNT_REF: 60,
  DUPLICATE_RECEIPT: 40,
  IDEMPOTENT_REPLAY: 40,
  WEBHOOK_SECRET_MISMATCH: 90,
};

function deriveRiskLevel(score) {
  if (score >= 80) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

function mergeFlags(existing, incoming) {
  const base = existing && typeof existing === 'object' ? existing : {};
  return { ...base, ...incoming };
}

function computeRisk({ payment, reasonCodes = [], recentRows = [] }) {
  const flags = {};
  let score = 0;

  reasonCodes.forEach((code) => {
    const value = REASON_SCORE[code];
    if (!value) return;
    score += value;
    flags[code] = { score: value };
  });

  const amount = Number(payment.amount || 0);
  if (Number.isFinite(amount) && amount >= DEFAULT_LARGE_AMOUNT) {
    score += 20;
    flags.LARGE_AMOUNT_THRESHOLD = { amount, threshold: DEFAULT_LARGE_AMOUNT };
  }

  const windowMs = RAPID_FIRE_WINDOW_SEC * 1000;
  const now = payment.created_at ? new Date(payment.created_at) : new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  const withinWindow = recentRows.filter((row) => {
    const ts = row.created_at ? new Date(row.created_at) : null;
    return ts && ts >= windowStart;
  });

  const rapidCount = withinWindow.length + 1;
  if (rapidCount > RAPID_FIRE_THRESHOLD) {
    score += 30;
    flags.RAPID_FIRE_SAME_MSISDN = { count: rapidCount, window_sec: RAPID_FIRE_WINDOW_SEC };
  }

  const aliasSet = new Set();
  const ownAlias = normalizeRef(payment.account_reference || '');
  if (ownAlias) aliasSet.add(ownAlias);
  withinWindow.forEach((row) => {
    const ref = normalizeRef(row.account_reference || '');
    if (ref) aliasSet.add(ref);
  });
  if (aliasSet.size >= MULTI_ALIAS_THRESHOLD) {
    score += 25;
    flags.MULTIPLE_ALIASES_SAME_MSISDN = { count: aliasSet.size, window_sec: RAPID_FIRE_WINDOW_SEC };
  }

  const risk_level = deriveRiskLevel(score);

  return {
    risk_score: score,
    risk_level,
    risk_flags: flags,
  };
}

async function createOpsAlertOnce({
  client,
  paymentId,
  type,
  severity,
  entityType,
  entityId,
  message,
  meta,
}) {
  const db = client || pool;
  if (paymentId) {
    const { rows } = await db.query(
      `
        SELECT id
        FROM ops_alerts
        WHERE payment_id = $1 AND type = $2
        LIMIT 1
      `,
      [paymentId, type]
    );
    if (rows.length) return rows[0];
  }

  return createOpsAlert({
    type,
    severity,
    entity_type: entityType,
    entity_id: entityId,
    payment_id: paymentId,
    message,
    meta,
    client: db,
  });
}

async function emitOpsAlerts({ payment, flags, reasonCodes, client }) {
  if (!payment?.id) return;
  const db = client || pool;
  const alertKeys = new Set([...(reasonCodes || []), ...Object.keys(flags || {})]);
  if (!alertKeys.size) return;

  const entityType = payment.msisdn ? 'MSISDN' : null;
  const entityId = payment.msisdn || null;
  const metaBase = {
    receipt: payment.receipt || null,
    checkout_request_id: payment.checkout_request_id || null,
    account_reference: payment.account_reference || null,
  };

  if (alertKeys.has('PAYBILL_MISMATCH')) {
    await createOpsAlertOnce({
      client: db,
      paymentId: payment.id,
      type: 'PAYBILL_MISMATCH',
      severity: 'CRITICAL',
      entityType,
      entityId,
      message: 'Paybill mismatch received; payment quarantined.',
      meta: { ...metaBase, flag: flags.PAYBILL_MISMATCH || null },
    });
  }

  if (alertKeys.has('WEBHOOK_SECRET_MISMATCH')) {
    await createOpsAlertOnce({
      client: db,
      paymentId: payment.id,
      type: 'WEBHOOK_SECRET_MISMATCH',
      severity: 'CRITICAL',
      entityType,
      entityId,
      message: 'Webhook secret mismatch; callback quarantined.',
      meta: { ...metaBase, flag: flags.WEBHOOK_SECRET_MISMATCH || null },
    });
  }

  if (alertKeys.has('INVALID_MANUAL_ACCOUNT_REF')) {
    await createOpsAlertOnce({
      client: db,
      paymentId: payment.id,
      type: 'INVALID_MANUAL_ACCOUNT_REF',
      severity: 'WARN',
      entityType,
      entityId,
      message: 'Invalid manual account reference received; payment quarantined.',
      meta: { ...metaBase, flag: flags.INVALID_MANUAL_ACCOUNT_REF || null },
    });
  }

  if (alertKeys.has('INVALID_CHECKSUM_REF')) {
    await createOpsAlertOnce({
      client: db,
      paymentId: payment.id,
      type: 'INVALID_CHECKSUM_REF',
      severity: 'WARN',
      entityType,
      entityId,
      message: 'Invalid checksum account reference received; payment quarantined.',
      meta: { ...metaBase, flag: flags.INVALID_CHECKSUM_REF || null },
    });
  }

  if (alertKeys.has('UNKNOWN_ACCOUNT_REF')) {
    await createOpsAlertOnce({
      client: db,
      paymentId: payment.id,
      type: 'UNKNOWN_ACCOUNT_REF',
      severity: 'WARN',
      entityType,
      entityId,
      message: 'Unknown account reference received; payment quarantined.',
      meta: { ...metaBase, flag: flags.UNKNOWN_ACCOUNT_REF || null },
    });
  }

  if (alertKeys.has('DUPLICATE_RECEIPT')) {
    await createOpsAlertOnce({
      client: db,
      paymentId: payment.id,
      type: 'DUPLICATE_RECEIPT',
      severity: 'WARN',
      entityType,
      entityId,
      message: 'Duplicate receipt/callback detected.',
      meta: { ...metaBase, flag: flags.DUPLICATE_RECEIPT || null },
    });
  }

  if (alertKeys.has('RAPID_FIRE_SAME_MSISDN')) {
    await createOpsAlertOnce({
      client: db,
      paymentId: payment.id,
      type: 'RAPID_FIRE_SAME_MSISDN',
      severity: 'WARN',
      entityType,
      entityId,
      message: 'Rapid-fire payments detected from same MSISDN.',
      meta: { ...metaBase, flag: flags.RAPID_FIRE_SAME_MSISDN || null },
    });
  }

  if (alertKeys.has('MULTIPLE_ALIASES_SAME_MSISDN')) {
    await createOpsAlertOnce({
      client: db,
      paymentId: payment.id,
      type: 'MULTIPLE_ALIASES_SAME_MSISDN',
      severity: 'WARN',
      entityType,
      entityId,
      message: 'Multiple aliases paid by same MSISDN in a short window.',
      meta: { ...metaBase, flag: flags.MULTIPLE_ALIASES_SAME_MSISDN || null },
    });
  }
}

async function applyRiskRules({ paymentId, payment, reasonCodes = [], client = null }) {
  const db = client || pool;
  let row = payment;

  if (!row && paymentId) {
    const res = await db.query(
      `
        SELECT id, status, msisdn, account_reference, amount, created_at, risk_flags, risk_score, risk_level,
               receipt, checkout_request_id
        FROM mpesa_c2b_payments
        WHERE id = $1
        LIMIT 1
      `,
      [paymentId]
    );
    row = res.rows[0];
  }

  if (!row) return null;

  let recentRows = [];
  if (row.msisdn) {
    const anchor = row.created_at ? new Date(row.created_at) : new Date();
    const windowStart = new Date(anchor.getTime() - RAPID_FIRE_WINDOW_SEC * 1000);
    const recentRes = await db.query(
      `
        SELECT id, account_reference, created_at
        FROM mpesa_c2b_payments
        WHERE msisdn = $1
          AND created_at >= $2
      `,
      [row.msisdn, windowStart.toISOString()]
    );
    recentRows = recentRes.rows.filter((r) => r.id !== row.id);
  }

  const computed = computeRisk({ payment: row, reasonCodes, recentRows });
  const mergedFlags = mergeFlags(row.risk_flags, computed.risk_flags);

  const existingScore = Number(row.risk_score || 0);
  const existingLevel = String(row.risk_level || 'LOW').toUpperCase();
  const minScore =
    existingLevel === 'HIGH' ? 80 : existingLevel === 'MEDIUM' ? 50 : 0;
  const finalScore = Math.max(existingScore, computed.risk_score, minScore);
  const finalLevel = deriveRiskLevel(finalScore);

  await db.query(
    `
      UPDATE mpesa_c2b_payments
      SET risk_score = $1,
          risk_level = $2,
          risk_flags = $3
      WHERE id = $4
    `,
    [finalScore, finalLevel, mergedFlags, row.id]
  );

  await emitOpsAlerts({
    payment: row,
    flags: mergedFlags,
    reasonCodes,
    client: db,
  });

  if (finalLevel === 'HIGH') {
    if (row.status === 'RECEIVED') {
      await db.query(`UPDATE mpesa_c2b_payments SET status = 'QUARANTINED' WHERE id = $1`, [row.id]);
    } else if (row.status === 'CREDITED') {
      await createOpsAlert({
        type: 'HIGH_RISK_PAYMENT',
        severity: 'CRITICAL',
        entity_type: row.msisdn ? 'MSISDN' : null,
        entity_id: row.msisdn || null,
        payment_id: row.id,
        message: 'High-risk payment already credited; review recommended.',
        meta: { risk_flags: mergedFlags, risk_score: finalScore },
        client: db,
      });
    }
  }

  return {
    risk_score: finalScore,
    risk_level: finalLevel,
    risk_flags: mergedFlags,
  };
}

module.exports = {
  computeRisk,
  applyRiskRules,
};
