const pool = require('../db/pool');

const WALLET_KIND_KEYS = {
  SACCO_FEE: 'SACCO_DAILY_FEE',
  SACCO_LOAN: 'SACCO_LOAN',
  SACCO_SAVINGS: 'SACCO_SAVINGS',
};

function normalizeWalletKind(kind) {
  return String(kind || '').trim().toUpperCase();
}

function normalizePayoutWalletKind(kind) {
  const raw = normalizeWalletKind(kind);
  if (raw === 'SACCO_DAILY_FEE' || raw === 'FEE' || raw === 'SACCO_FEE') return 'SACCO_FEE';
  if (raw === 'SACCO_LOAN' || raw === 'LOAN') return 'SACCO_LOAN';
  if (raw === 'SACCO_SAVINGS' || raw === 'SAVINGS') return 'SACCO_SAVINGS';
  return raw;
}

async function insertPayoutEvent({
  batchId = null,
  itemId = null,
  actorId = null,
  eventType,
  message = null,
  meta = {},
  client = null,
} = {}) {
  if (!eventType) throw new Error('eventType is required');
  const db = client || pool;
  await db.query(
    `
      INSERT INTO payout_events
        (batch_id, item_id, actor_id, event_type, message, meta)
      VALUES
        ($1, $2, $3, $4, $5, $6)
    `,
    [batchId, itemId, actorId, eventType, message, meta]
  );
}

async function updateBatchStatusFromItems({ batchId, client = null, actorId = null } = {}) {
  if (!batchId) return null;
  const db = client || pool;

  const { rows } = await db.query(
    `
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END)::int AS confirmed,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed,
        SUM(CASE WHEN status = 'BLOCKED' THEN 1 ELSE 0 END)::int AS blocked,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END)::int AS cancelled
      FROM payout_items
      WHERE batch_id = $1
    `,
    [batchId]
  );

  const stats = rows[0] || { total: 0, confirmed: 0, failed: 0, blocked: 0, cancelled: 0 };
  if (!stats.total) return null;

  let nextStatus = 'PROCESSING';
  const doneCount = stats.confirmed + stats.blocked + stats.cancelled;
  if (stats.failed > 0) nextStatus = 'FAILED';
  else if (doneCount === stats.total) nextStatus = 'COMPLETED';

  const { rows: batchRows } = await db.query(
    `SELECT status FROM payout_batches WHERE id = $1 LIMIT 1`,
    [batchId]
  );
  const currentStatus = batchRows[0]?.status || null;
  if (currentStatus && currentStatus !== nextStatus) {
    await db.query(
      `
        UPDATE payout_batches
        SET status = $1
        WHERE id = $2
      `,
      [nextStatus, batchId]
    );
    await insertPayoutEvent({
      batchId,
      actorId,
      eventType: nextStatus === 'COMPLETED' ? 'BATCH_COMPLETED' : 'BATCH_FAILED',
      message: `Batch ${nextStatus.toLowerCase()}`,
      meta: stats,
      client: db,
    });
  }

  return { ...stats, status: nextStatus };
}

module.exports = {
  WALLET_KIND_KEYS,
  normalizeWalletKind,
  normalizePayoutWalletKind,
  insertPayoutEvent,
  updateBatchStatusFromItems,
};
