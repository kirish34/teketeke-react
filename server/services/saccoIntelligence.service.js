const pool = require('../db/pool');
const { parseRange } = require('./monitoring.service');

async function saccoOverview({ saccoId, from, to, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const params = [saccoId, fromTs.toISOString(), toTs.toISOString()];

  const [fleetRes, collectionsRes, paymentsRes, riskRes, peakRes, topVehiclesRes] = await Promise.all([
    db.query(
      `
        SELECT
          COUNT(*)::int AS vehicles_total,
          SUM(CASE WHEN status IS NULL OR status = 'ACTIVE' THEN 1 ELSE 0 END)::int AS active_vehicles,
          SUM(CASE WHEN status IS NOT NULL AND status != 'ACTIVE' THEN 1 ELSE 0 END)::int AS inactive_vehicles
        FROM matatus
        WHERE sacco_id = $1
      `,
      [saccoId],
    ),
    db.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN entry_type ILIKE '%FEE%' THEN amount ELSE 0 END),0)::numeric AS daily_fees_total,
          COALESCE(SUM(CASE WHEN entry_type ILIKE '%SAVINGS%' THEN amount ELSE 0 END),0)::numeric AS savings_total,
          COALESCE(SUM(CASE WHEN entry_type ILIKE '%LOAN_REPAY%' THEN amount ELSE 0 END),0)::numeric AS loans_repaid_total
        FROM wallet_ledger wl
        JOIN wallets w ON w.id = wl.wallet_id
        WHERE w.sacco_id = $1 AND wl.created_at BETWEEN $2 AND $3
      `,
      params,
    ),
    db.query(
      `
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN (meta->>'result') = 'accepted' THEN 1 ELSE 0 END)::int AS accepted,
          SUM(CASE WHEN entity_type = 'C2B' THEN 1 ELSE 0 END)::int AS c2b
        FROM admin_audit_logs
        WHERE sacco_id::text = $1::text AND action = 'mpesa_callback' AND created_at BETWEEN $2 AND $3
      `,
      params,
    ),
    db.query(
      `
        SELECT
          COALESCE((SELECT COUNT(*) FROM fraud_alerts WHERE entity_type = 'SACCO' AND entity_id = $1 AND status = 'open'),0)::int AS open_alerts,
          COALESCE((SELECT COUNT(*) FROM fraud_alerts WHERE entity_type = 'SACCO' AND entity_id = $1 AND status = 'open' AND LOWER(severity) IN ('high','critical')),0)::int AS high_alerts,
          COALESCE((SELECT COUNT(*) FROM recon_items WHERE (details->>'sacco_id') = $1::text),0)::int AS recon_exceptions
      `,
      [saccoId],
    ),
    db.query(
      `
        SELECT date_part('hour', wl.created_at)::int AS hour, COUNT(*)::int AS count
        FROM wallet_ledger wl
        JOIN wallets w ON w.id = wl.wallet_id
        WHERE w.sacco_id = $1 AND wl.created_at BETWEEN $2 AND $3
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 6
      `,
      params,
    ),
    db.query(
      `
        SELECT m.id, m.number_plate AS name, COUNT(wl.id)::int AS tx_count, COALESCE(SUM(wl.amount),0)::numeric AS volume
        FROM matatus m
        LEFT JOIN wallets w ON w.entity_id = m.id AND w.entity_type = 'MATATU'
        LEFT JOIN wallet_ledger wl ON wl.wallet_id = w.id AND wl.created_at BETWEEN $2 AND $3
        WHERE m.sacco_id = $1
        GROUP BY m.id, m.number_plate
        ORDER BY volume DESC
        LIMIT 5
      `,
      params,
    ),
  ]);

  const fleet = fleetRes.rows?.[0] || {};
  const coll = collectionsRes.rows?.[0] || {};
  const pay = paymentsRes.rows?.[0] || {};
  const risk = riskRes.rows?.[0] || {};

  const successRate = pay.total ? Math.round(((pay.accepted || 0) / pay.total) * 1000) / 10 : 0;

  return {
    ok: true,
    sacco_id: saccoId,
    from: fromTs.toISOString(),
    to: toTs.toISOString(),
    fleet: {
      vehicles_total: Number(fleet.vehicles_total || 0),
      active_vehicles: Number(fleet.active_vehicles || 0),
      inactive_vehicles: Number(fleet.inactive_vehicles || 0),
    },
    collections: {
      daily_fees_total: Number(coll.daily_fees_total || 0),
      savings_total: Number(coll.savings_total || 0),
      loans_repaid_total: Number(coll.loans_repaid_total || 0),
    },
    payments: {
      c2b_count: Number(pay.c2b || 0),
      success_rate: successRate,
    },
    risk: {
      open_alerts: Number(risk.open_alerts || 0),
      high_alerts: Number(risk.high_alerts || 0),
      recon_exceptions: Number(risk.recon_exceptions || 0),
    },
    performance: {
      peak_hours: peakRes.rows || [],
      top_routes: [], // safe fallback
      top_vehicles: topVehiclesRes.rows || [],
    },
  };
}

async function saccoVehicles({ saccoId, status, from, to, limit = 20, offset = 0, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const params = [saccoId, fromTs.toISOString(), toTs.toISOString(), limit, offset];
  const where = ['m.sacco_id = $1'];
  if (status === 'active') where.push("(m.status IS NULL OR m.status = 'ACTIVE')");
  if (status === 'inactive') where.push("(m.status IS NOT NULL AND m.status != 'ACTIVE')");
  const sql = `
    SELECT m.id, m.number_plate AS name, m.status,
           COUNT(wl.id)::int AS tx_count,
           COALESCE(SUM(wl.amount),0)::numeric AS volume
    FROM matatus m
    LEFT JOIN wallets w ON w.entity_id = m.id AND w.entity_type = 'MATATU'
    LEFT JOIN wallet_ledger wl ON wl.wallet_id = w.id AND wl.created_at BETWEEN $2 AND $3
    WHERE ${where.join(' AND ')}
    GROUP BY m.id, m.number_plate, m.status
    ORDER BY volume DESC
    LIMIT $4 OFFSET $5
  `;
  const { rows } = await db.query(sql, params);
  return { ok: true, items: rows || [] };
}

module.exports = {
  saccoOverview,
  saccoVehicles,
};
