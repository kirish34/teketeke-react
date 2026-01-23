const pool = require('../db/pool');
const { parseRange } = require('./monitoring.service');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function makeCacheKey(name, from, to) {
  return `${name}:${from || 'null'}:${to || 'null'}`;
}

function setCache(key, value) {
  cache.set(key, { value, ts: Date.now() });
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

async function systemOverview({ from, to, db = pool }) {
  const key = makeCacheKey('systemOverview', from, to);
  const cached = getCache(key);
  if (cached) return cached;

  const { fromTs, toTs } = parseRange({ from, to });
  const params = [fromTs.toISOString(), toTs.toISOString()];

  const [
    growthRes,
    revenueRes,
    paymentsRes,
    payoutsRes,
    reconRes,
    fraudRes,
    quarantineRes,
    topSaccosRes,
  ] = await Promise.all([
    db.query(
      `
        SELECT
          COALESCE((SELECT COUNT(*) FROM saccos WHERE created_at BETWEEN $1 AND $2),0)::int AS saccos_new,
          COALESCE((SELECT COUNT(*) FROM matatus WHERE created_at BETWEEN $1 AND $2),0)::int AS vehicles_new,
          COALESCE((SELECT COUNT(*) FROM matatus WHERE updated_at BETWEEN $1 AND $2 OR created_at BETWEEN $1 AND $2),0)::int AS active_vehicles,
          COALESCE((SELECT COUNT(*) FROM saccos),0)::int AS active_saccos
      `,
      params,
    ),
    db.query(
      `
        SELECT
          COALESCE((SELECT SUM(amount) FROM wallet_ledger WHERE entry_type ILIKE '%FEE%' AND created_at BETWEEN $1 AND $2),0)::numeric AS fees_collected,
          COALESCE((SELECT SUM(amount) FROM payout_items WHERE created_at BETWEEN $1 AND $2),0)::numeric AS payouts_total,
          COALESCE((SELECT SUM(amount) FROM wallet_ledger WHERE created_at BETWEEN $1 AND $2),0)::numeric AS net_flow
      `,
      params,
    ),
    db.query(
      `
        SELECT
          SUM(CASE WHEN COALESCE(result, meta->>'result') = 'accepted' THEN 1 ELSE 0 END)::int AS accepted,
          SUM(CASE WHEN COALESCE(result, meta->>'result') = 'duplicate' THEN 1 ELSE 0 END)::int AS duplicate,
          SUM(CASE WHEN COALESCE(result, meta->>'result') IN ('failed','rejected','error') THEN 1 ELSE 0 END)::int AS failed,
          COUNT(*)::int AS total,
          SUM(CASE WHEN COALESCE(resource_type, entity_type) = 'C2B' THEN 1 ELSE 0 END)::int AS c2b,
          SUM(CASE WHEN COALESCE(resource_type, entity_type) = 'STK' THEN 1 ELSE 0 END)::int AS stk
        FROM admin_audit_logs
        WHERE action = 'mpesa_callback'
          AND created_at BETWEEN $1 AND $2
      `,
      params,
    ),
    db.query(
      `
        SELECT
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed,
          COUNT(*)::int AS total
        FROM payout_items
        WHERE created_at BETWEEN $1 AND $2
      `,
      params,
    ),
    db.query(
      `
        SELECT COUNT(*)::int AS exceptions
        FROM recon_items
        WHERE status IN ('missing_internal','unmatched','mismatch_amount')
          AND created_at BETWEEN $1 AND $2
      `,
      params,
    ),
    db.query(
      `
        SELECT COUNT(*)::int AS open_high
        FROM fraud_alerts
        WHERE status = 'open' AND LOWER(severity) IN ('high','critical')
      `,
    ),
    db.query(
      `
        SELECT COUNT(*)::int AS open_quarantine
        FROM quarantined_operations
        WHERE status = 'quarantined'
      `,
    ),
    db.query(
      `
        SELECT pb.sacco_id,
               s.name,
               COALESCE(SUM(pb.total_amount),0)::numeric AS volume,
               COUNT(DISTINCT pi.id)::int AS items
        FROM payout_batches pb
        LEFT JOIN saccos s ON s.id = pb.sacco_id
        LEFT JOIN payout_items pi ON pi.batch_id = pb.id
        WHERE pb.created_at BETWEEN $1 AND $2
        GROUP BY pb.sacco_id, s.name
        ORDER BY volume DESC
        LIMIT 5
      `,
      params,
    ),
  ]);

  const growthRow = growthRes.rows?.[0] || {};
  const revenueRow = revenueRes.rows?.[0] || {};
  const payRow = paymentsRes.rows?.[0] || {};
  const payoutRow = payoutsRes.rows?.[0] || {};
  const reconRow = reconRes.rows?.[0] || {};
  const fraudRow = fraudRes.rows?.[0] || {};
  const quarantineRow = quarantineRes.rows?.[0] || {};

  const totalCallbacks = Number(payRow.total || 0);
  const successRate = totalCallbacks ? Number(((payRow.accepted || 0) / totalCallbacks) * 100).toFixed(1) : '0';
  const duplicateRate = totalCallbacks ? Number(((payRow.duplicate || 0) / totalCallbacks) * 100).toFixed(1) : '0';
  const failureRate = totalCallbacks ? Number(((payRow.failed || 0) / totalCallbacks) * 100).toFixed(1) : '0';
  const payoutFailRate = payoutRow.total
    ? Number(((payoutRow.failed || 0) / payoutRow.total) * 100).toFixed(1)
    : '0';

  const value = {
    ok: true,
    from: fromTs.toISOString(),
    to: toTs.toISOString(),
    growth: {
      saccos_new: Number(growthRow.saccos_new || 0),
      vehicles_new: Number(growthRow.vehicles_new || 0),
      active_vehicles: Number(growthRow.active_vehicles || 0),
      active_saccos: Number(growthRow.active_saccos || 0),
    },
    revenue: {
      fees_collected: Number(revenueRow.fees_collected || 0),
      payouts_total: Number(revenueRow.payouts_total || 0),
      net_flow: Number(revenueRow.net_flow || 0),
    },
    payments: {
      c2b_count: Number(payRow.c2b || 0),
      stk_count: Number(payRow.stk || 0),
      success_rate: successRate,
      duplicate_rate: duplicateRate,
      failure_rate: failureRate,
    },
    ops: {
      payout_fail_rate: payoutFailRate,
      recon_exception_rate: Number(reconRow.exceptions || 0),
      fraud_open_high: Number(fraudRow.open_high || 0),
      quarantine_open: Number(quarantineRow.open_quarantine || 0),
    },
    top_saccos: topSaccosRes.rows || [],
    top_routes: [], // optional, safe fallback
  };

  setCache(key, value);
  return value;
}

async function systemTrends({ from, to, metric, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const params = [fromTs.toISOString(), toTs.toISOString()];
  let sql;
  switch (metric) {
    case 'fees_collected':
      sql = `
        SELECT date_trunc('day', created_at) AS d, SUM(amount)::numeric AS v
        FROM wallet_ledger
        WHERE entry_type ILIKE '%FEE%' AND created_at BETWEEN $1 AND $2
        GROUP BY d ORDER BY d
      `;
      break;
    case 'c2b_count':
      sql = `
        SELECT date_trunc('day', created_at) AS d, COUNT(*)::int AS v
        FROM admin_audit_logs
        WHERE action = 'mpesa_callback' AND COALESCE(resource_type, entity_type) = 'C2B' AND created_at BETWEEN $1 AND $2
        GROUP BY d ORDER BY d
      `;
      break;
    case 'stk_count':
      sql = `
        SELECT date_trunc('day', created_at) AS d, COUNT(*)::int AS v
        FROM admin_audit_logs
        WHERE action = 'mpesa_callback' AND COALESCE(resource_type, entity_type) = 'STK' AND created_at BETWEEN $1 AND $2
        GROUP BY d ORDER BY d
      `;
      break;
    case 'payout_fail_rate':
      sql = `
        SELECT date_trunc('day', created_at) AS d,
               SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed,
               COUNT(*)::int AS total
        FROM payout_items
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY d ORDER BY d
      `;
      break;
    case 'recon_exceptions':
      sql = `
        SELECT date_trunc('day', created_at) AS d, COUNT(*)::int AS v
        FROM recon_items
        WHERE status IN ('missing_internal','unmatched','mismatch_amount')
          AND created_at BETWEEN $1 AND $2
        GROUP BY d ORDER BY d
      `;
      break;
    case 'fraud_open':
      sql = `
        SELECT date_trunc('day', created_at) AS d, COUNT(*)::int AS v
        FROM fraud_alerts
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY d ORDER BY d
      `;
      break;
    default:
      return { ok: true, points: [] };
  }
  const { rows } = await db.query(sql, params);
  const points = (rows || []).map((r) => {
    if (metric === 'payout_fail_rate') {
      const total = Number(r.total || 0);
      const failed = Number(r.failed || 0);
      const value = total ? Math.round((failed / total) * 1000) / 10 : 0;
      return { date: r.d, value };
    }
    return { date: r.d, value: Number(r.v || 0) };
  });
  return { ok: true, points };
}

async function topEntities({ kind, from, to, limit = 20, offset = 0, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const params = [fromTs.toISOString(), toTs.toISOString(), limit, offset];
  let sql = '';
  if (kind === 'sacco') {
    sql = `
      SELECT pb.sacco_id AS id, s.name, SUM(pb.total_amount)::numeric AS volume, COUNT(*)::int AS batches
      FROM payout_batches pb
      LEFT JOIN saccos s ON s.id = pb.sacco_id
      WHERE pb.created_at BETWEEN $1 AND $2
      GROUP BY pb.sacco_id, s.name
      ORDER BY volume DESC
      LIMIT $3 OFFSET $4
    `;
  } else if (kind === 'vehicle') {
    sql = `
      SELECT m.id, m.number_plate AS name, COUNT(wl.id)::int AS tx_count, COALESCE(SUM(wl.amount),0)::numeric AS volume
      FROM matatus m
      LEFT JOIN wallets w ON w.entity_id = m.id AND w.entity_type = 'MATATU'
      LEFT JOIN wallet_ledger wl ON wl.wallet_id = w.id AND wl.created_at BETWEEN $1 AND $2
      WHERE m.created_at <= $2
      GROUP BY m.id, m.number_plate
      ORDER BY volume DESC
      LIMIT $3 OFFSET $4
    `;
  } else if (kind === 'route') {
    sql = `
      SELECT r.id, r.name, COUNT(*)::int AS trips
      FROM routes r
      WHERE r.created_at BETWEEN $1 AND $2
      GROUP BY r.id, r.name
      ORDER BY trips DESC
      LIMIT $3 OFFSET $4
    `;
  } else {
    return { ok: true, items: [] };
  }
  const { rows } = await db.query(sql, params);
  return { ok: true, items: rows || [] };
}

module.exports = {
  systemOverview,
  systemTrends,
  topEntities,
};
