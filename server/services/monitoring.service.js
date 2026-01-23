const pool = require('../db/pool');
const { isQueueEnabled, getQueue } = require('../queues/queue');

function parseRange({ from, to }) {
  const now = new Date();
  const toTs = to ? new Date(to) : now;
  const fromTs = from ? new Date(from) : new Date(now.getTime() - 24 * 3600 * 1000);
  if (Number.isNaN(fromTs.getTime()) || Number.isNaN(toTs.getTime())) {
    throw new Error('invalid range');
  }
  return { fromTs, toTs };
}

async function getCallbackOverview({ from, to, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const res = await db.query(
    `
      SELECT (payload->>'result')::text AS result, COUNT(*)::int AS count
      FROM admin_audit_logs
      WHERE domain = 'teketeke'
        AND action = 'mpesa_callback'
        AND created_at BETWEEN $1 AND $2
      GROUP BY result
    `,
    [fromTs.toISOString(), toTs.toISOString()],
  );
  const counts = { accepted: 0, duplicate: 0, ignored: 0, failure: 0 };
  (res.rows || []).forEach((row) => {
    const key = (row.result || '').toLowerCase();
    if (key === 'accepted') counts.accepted += row.count;
    else if (key === 'duplicate') counts.duplicate += row.count;
    else if (key === 'ignored') counts.ignored += row.count;
    else if (key === 'rejected' || key === 'failure' || key === 'failed') counts.failure += row.count;
  });
  const total = counts.accepted + counts.duplicate + counts.ignored + counts.failure;
  return { ...counts, total };
}

async function getPayoutOverview({ from, to, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const batchRes = await db.query(
    `
      SELECT status, COUNT(*)::int AS count
      FROM payout_batches
      WHERE created_at BETWEEN $1 AND $2
      GROUP BY status
    `,
    [fromTs.toISOString(), toTs.toISOString()],
  );
  const itemRes = await db.query(
    `
      SELECT status, COUNT(*)::int AS count,
             AVG(extract(epoch from (COALESCE(updated_at, now()) - created_at))) AS avg_time_sec
      FROM payout_items
      WHERE created_at BETWEEN $1 AND $2
      GROUP BY status
    `,
    [fromTs.toISOString(), toTs.toISOString()],
  );
  const batches = {};
  (batchRes.rows || []).forEach((r) => {
    batches[r.status] = r.count;
  });
  const items = { total: 0, success: 0, failed: 0, avg_time_sec: null };
  let avgCount = 0;
  let avgTotal = 0;
  (itemRes.rows || []).forEach((r) => {
    items.total += r.count;
    const st = (r.status || '').toUpperCase();
    if (['SENT', 'PAID', 'SUCCESS', 'COMPLETED'].includes(st)) items.success += r.count;
    if (['FAILED', 'BLOCKED', 'REJECTED'].includes(st)) items.failed += r.count;
    if (r.avg_time_sec !== null) {
      avgTotal += Number(r.avg_time_sec || 0) * r.count;
      avgCount += r.count;
    }
  });
  items.avg_time_sec = avgCount ? Math.round(avgTotal / avgCount) : null;
  return {
    batches_total: Object.values(batches).reduce((a, b) => a + b, 0),
    batches_processing: batches.PROCESSING || 0,
    batches_done: (batches.COMPLETED || 0) + (batches.FAILED || 0) + (batches.CANCELLED || 0),
    items_total: items.total,
    items_success: items.success,
    items_failed: items.failed,
    avg_time_sec: items.avg_time_sec,
  };
}

async function getWalletOverview({ from, to, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const res = await db.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE amount > 0)::int AS credits,
        COUNT(*) FILTER (WHERE amount < 0)::int AS debits,
        COALESCE(SUM(amount),0)::numeric AS net
      FROM wallet_ledger
      WHERE created_at BETWEEN $1 AND $2
    `,
    [fromTs.toISOString(), toTs.toISOString()],
  );
  const row = res.rows[0] || {};
  return {
    credits: Number(row.credits || 0),
    debits: Number(row.debits || 0),
    net: Number(row.net || 0),
    errors: 0,
  };
}

async function getJobOverview() {
  if (!isQueueEnabled()) return { enabled: false, waiting: 0, active: 0, completed: 0, failed: 0 };
  const queue = getQueue();
  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
  return {
    enabled: true,
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    completed: counts.completed || 0,
    failed: counts.failed || 0,
  };
}

async function getMonitoringOverview({ from, to, db = pool }) {
  const [callbacks, payouts, wallets, jobs] = await Promise.all([
    getCallbackOverview({ from, to, db }),
    getPayoutOverview({ from, to, db }),
    getWalletOverview({ from, to, db }),
    getJobOverview(),
  ]);
  const { fromTs, toTs } = parseRange({ from, to });
  return {
    ok: true,
    from: fromTs.toISOString(),
    to: toTs.toISOString(),
    callbacks,
    payouts,
    wallets,
    jobs,
  };
}

async function listCallbacks({ from, to, kind, result, limit = 50, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const params = [fromTs.toISOString(), toTs.toISOString()];
  const where = [
    "domain = 'teketeke'",
    "action = 'mpesa_callback'",
    'created_at BETWEEN $1 AND $2',
  ];
  if (kind) {
    params.push(kind);
    where.push(`resource_type = $${params.length}`);
  }
  if (result) {
    params.push(result.toLowerCase());
    where.push(`(payload->>'result') = $${params.length}`);
  }
  params.push(limit);
  const res = await db.query(
    `
      SELECT created_at, resource_type AS kind, resource_id, payload
      FROM admin_audit_logs
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `,
    params,
  );
  return res.rows || [];
}

async function listPayouts({ from, to, status, limit = 50, db = pool }) {
  const { fromTs, toTs } = parseRange({ from, to });
  const params = [fromTs.toISOString(), toTs.toISOString()];
  const where = ['pi.created_at BETWEEN $1 AND $2'];
  if (status) {
    params.push(status.toUpperCase());
    where.push(`pi.status = $${params.length}`);
  } else {
    where.push(`pi.status IN ('FAILED','BLOCKED','REJECTED')`);
  }
  params.push(limit);
  const res = await db.query(
    `
      SELECT
        pi.id,
        pi.status,
        pi.failure_reason,
        pi.amount,
        pi.created_at,
        pb.id AS batch_id,
        pb.status AS batch_status
      FROM payout_items pi
      LEFT JOIN payout_batches pb ON pb.id = pi.batch_id
      WHERE ${where.join(' AND ')}
      ORDER BY pi.created_at DESC
      LIMIT $${params.length}
    `,
    params,
  );
  return res.rows || [];
}

async function listJobs({ limit = 50 }) {
  if (!isQueueEnabled()) return { enabled: false, items: [] };
  const queue = getQueue();
  const jobs = await queue.getJobs(['failed', 'waiting', 'active'], 0, limit - 1, true);
  return {
    enabled: true,
    items: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      state: job.failedReason ? 'failed' : job.finishedOn ? 'completed' : 'pending',
      failedReason: job.failedReason || null,
      data: job.data || {},
      timestamp: job.timestamp,
    })),
  };
}

module.exports = {
  parseRange,
  getMonitoringOverview,
  listCallbacks,
  listPayouts,
  listJobs,
};
