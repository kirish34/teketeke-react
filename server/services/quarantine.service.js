const pool = require('../db/pool');
const { logAdminAction } = require('./audit.service');
const { creditWallet } = require('../wallet/wallet.service');

const DOMAIN = 'teketeke';

function norm(value) {
  return value ? String(value).toUpperCase() : null;
}

async function fetchHighAlert({ entityId, entityType = null, db = pool }) {
  if (!entityId) return null;
  const { rows } = await db.query(
    `
      SELECT id, severity, status
      FROM fraud_alerts
      WHERE domain = $1
        AND status = 'open'
        AND LOWER(severity) IN ('high','critical')
        AND entity_id = $2
        ${entityType ? 'AND entity_type = $3' : ''}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    entityType ? [DOMAIN, entityId, entityType] : [DOMAIN, entityId],
  );
  return rows?.[0] || null;
}

async function shouldQuarantine({
  operationType,
  entityType = null,
  entityId = null,
  incidentId = null,
  alertId = null,
  db = pool,
}) {
  if (String(process.env.QUARANTINE_DISABLED || '').toLowerCase() === 'true') {
    return { quarantine: false };
  }
  const entity = entityId || null;
  let alertRow = null;
  if (alertId) {
    const res = await db.query(`SELECT id, severity, status FROM fraud_alerts WHERE id = $1 LIMIT 1`, [alertId]);
    alertRow = res.rows?.[0] || null;
  } else {
    alertRow = await fetchHighAlert({ entityId: entity, entityType, db });
  }

  if (alertRow && alertRow.status === 'open') {
    return {
      quarantine: true,
      reason: 'high_severity_alert',
      severity: alertRow.severity || 'high',
      alert_id: alertRow.id,
      incident_id: incidentId || null,
    };
  }

  if (incidentId) {
    return {
      quarantine: true,
      reason: 'incident_high',
      severity: 'high',
      alert_id: alertId || null,
      incident_id: incidentId,
    };
  }

  return { quarantine: false };
}

async function quarantineOperation({
  operationType,
  operationId,
  entityType = null,
  entityId = null,
  reason = 'quarantine',
  source = 'FRAUD_ALERT',
  severity = 'high',
  incident_id = null,
  alert_id = null,
  payload = null,
  actorReq = null,
  db = pool,
}) {
  const res = await db.query(
    `
      INSERT INTO quarantined_operations
        (domain, operation_type, operation_id, entity_type, entity_id, reason, source, severity, incident_id, alert_id, payload)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (domain, operation_type, operation_id, status) DO NOTHING
      RETURNING *
    `,
    [
      DOMAIN,
      operationType,
      operationId,
      entityType || null,
      entityId || null,
      reason,
      source,
      severity,
      incident_id || null,
      alert_id || null,
      payload ? JSON.parse(JSON.stringify(payload)) : null,
    ],
  );

  let record = res.rows?.[0] || null;
  if (!record) {
    const existing = await db.query(
      `
        SELECT *
        FROM quarantined_operations
        WHERE domain = $1 AND operation_type = $2 AND operation_id = $3 AND status = 'quarantined'
        LIMIT 1
      `,
      [DOMAIN, operationType, operationId],
    );
    record = existing.rows?.[0] || null;
  }

  // No-op for payout batch/item quarantine (legacy flow removed)

  await logAdminAction({
    req: actorReq || { user: { id: null, role: null } },
    action: 'operation_quarantined',
    resource_type: operationType,
    resource_id: operationId,
    payload: { reason, source, severity, incident_id, alert_id },
  });

  return record;
}

async function releaseOperation({
  id,
  actorUserId = null,
  actorRole = null,
  note = null,
  resume = true,
  db = pool,
}) {
  const { rows } = await db.query(
    `
      UPDATE quarantined_operations
      SET status = 'released',
          released_at = now(),
          released_by = $2,
          release_note = $3
      WHERE id = $1 AND status = 'quarantined'
      RETURNING *
    `,
    [id, actorUserId || null, note || null],
  );
  if (!rows.length) throw new Error('not_found_or_not_quarantined');
  const record = rows[0];

  if (resume) {
    if (record.operation_type === 'WALLET_CREDIT') {
      const payload = record.payload || {};
      await creditWallet({
        virtualAccountCode: payload.virtualAccountCode,
        amount: payload.amount,
        source: payload.source || 'ADMIN_ADJUST',
        sourceRef: payload.sourceRef || null,
        description: payload.description || null,
      });
    }
  }

  await logAdminAction({
    req: { user: { id: actorUserId || null, role: actorRole || null }, requestId: `release-${id}` },
    action: 'quarantine_released',
    resource_type: record.operation_type,
    resource_id: record.operation_id,
    payload: { note },
  });

  return record;
}

async function cancelQuarantine({ id, actorUserId = null, actorRole = null, note = null, db = pool }) {
  const { rows } = await db.query(
    `
      UPDATE quarantined_operations
      SET status = 'cancelled',
          released_at = now(),
          released_by = $2,
          release_note = $3
      WHERE id = $1 AND status = 'quarantined'
      RETURNING *
    `,
    [id, actorUserId || null, note || null],
  );
  if (!rows.length) throw new Error('not_found_or_not_quarantined');
  const record = rows[0];
  await logAdminAction({
    req: { user: { id: actorUserId || null, role: actorRole || null }, requestId: `cancel-${id}` },
    action: 'quarantine_cancelled',
    resource_type: record.operation_type,
    resource_id: record.operation_id,
    payload: { note },
  });
  return record;
}

module.exports = {
  shouldQuarantine,
  quarantineOperation,
  releaseOperation,
  cancelQuarantine,
};
