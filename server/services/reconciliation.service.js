const pool = require('../db/pool');
const { logAdminAction } = require('./audit.service');

const DOMAIN = 'teketeke';

function parseTs(value, fallback) {
  if (value instanceof Date) return value;
  const d = value ? new Date(value) : fallback ? new Date(fallback) : null;
  if (!d || Number.isNaN(d.getTime())) {
    throw new Error('invalid timestamp');
  }
  return d;
}

function buildMatch(kind, provider, candidates) {
  if (!candidates || candidates.length === 0) {
    return {
      status: 'missing_internal',
      internal_ref: null,
      details: { reason: 'no_internal_match' },
    };
  }
  if (candidates.length > 1) {
    return {
      status: 'duplicate',
      internal_ref: candidates[0]?.id || null,
      details: { duplicate_count: candidates.length },
    };
  }
  const match = candidates[0];
  const providerAmount = Number(provider.amount || 0);
  const internalAmount = Number(match.amount || 0);
  if (Number.isFinite(providerAmount) && Number.isFinite(internalAmount) && providerAmount !== internalAmount) {
    return {
      status: 'mismatch_amount',
      internal_ref: match.id,
      details: { provider_amount: providerAmount, internal_amount: internalAmount },
    };
  }
  return { status: 'matched', internal_ref: match.id, details: {} };
}

async function upsertReconItem({ kind, provider_ref, amount, status, internal_ref, details }) {
  await pool.query(
    `
      INSERT INTO recon_items (domain, kind, provider_ref, amount, status, internal_ref, details, last_seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (domain, kind, provider_ref) DO UPDATE
        SET amount = EXCLUDED.amount,
            status = EXCLUDED.status,
            internal_ref = EXCLUDED.internal_ref,
            details = EXCLUDED.details,
            last_seen_at = now()
    `,
    [DOMAIN, kind, provider_ref, amount, status, internal_ref, details || {}],
  );
}

async function insertReconRun({ fromTs, toTs, totals, status = 'completed', actorUserId, actorRole, requestId }) {
  const res = await pool.query(
    `
      INSERT INTO recon_runs (domain, from_ts, to_ts, status, totals, actor_user_id, actor_role, request_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `,
    [DOMAIN, fromTs, toTs, status, totals || {}, actorUserId || null, actorRole || null, requestId || null],
  );
  return res.rows[0]?.id || null;
}

async function fetchC2bProviders(fromTs, toTs) {
  const res = await pool.query(
    `
      SELECT id, receipt, amount, status, created_at, checkout_request_id
      FROM mpesa_c2b_payments
      WHERE created_at BETWEEN $1 AND $2
    `,
    [fromTs, toTs],
  );
  return (res.rows || []).map((row) => {
    const isStk = Boolean(row.checkout_request_id);
    const provider_ref = row.receipt || row.checkout_request_id || row.id;
    return {
      kind: isStk ? 'STK' : 'C2B',
      provider_ref,
      amount: Number(row.amount || 0),
      raw_id: row.id,
    };
  });
}

async function fetchC2bLedgers(fromTs, toTs) {
  const res = await pool.query(
    `
      SELECT id, amount, reference_id, source_ref, provider, provider_ref, created_at
      FROM wallet_ledger
      WHERE created_at BETWEEN $1 AND $2
        AND (
          reference_type = 'MPESA_C2B'
          OR source = 'MPESA_C2B'
          OR source = 'MPESA'
          OR provider = 'mpesa'
        )
    `,
    [fromTs, toTs],
  );
  return res.rows || [];
}


function computeMatches(kind, providers, internal) {
  const items = [];
  for (const p of providers) {
    const ref = p.provider_ref;
    if (!ref) continue;
    let candidates = [];
    if (kind === 'C2B' || kind === 'STK') {
      candidates = internal.filter(
        (w) =>
          String(w.provider_ref || '') === String(ref) ||
          String(w.reference_id || '') === String(ref) ||
          String(w.source_ref || '') === String(ref) ||
          String(w.reference_id || '') === String(p.raw_id || ''),
      );
    }
    const match = buildMatch(kind, p, candidates);
    items.push({
      kind,
      provider_ref: ref,
      amount: p.amount,
      status: match.status,
      internal_ref: match.internal_ref,
      details: { ...(match.details || {}), raw_id: p.raw_id || null },
    });
  }
  return items;
}

async function runReconciliation({ fromTs, toTs, actorUserId = null, actorRole = null, requestId = null, mode = 'write' }) {
  const from = parseTs(fromTs);
  const to = parseTs(toTs);
  const dryRun = mode === 'dry';

  const totals = { C2B: {}, STK: {}, B2C: {} };
  const reconItems = [];

  const [providersC2b, ledgersC2b] = await Promise.all([
    fetchC2bProviders(from, to),
    fetchC2bLedgers(from, to),
  ]);

  const c2bProviders = providersC2b.filter((p) => p.kind === 'C2B');
  const stkProviders = providersC2b.filter((p) => p.kind === 'STK');

  const c2bMatches = computeMatches('C2B', c2bProviders, ledgersC2b);
  const stkMatches = computeMatches('STK', stkProviders, ledgersC2b);
  reconItems.push(...c2bMatches, ...stkMatches);

  for (const item of reconItems) {
    const bucket = totals[item.kind] || {};
    bucket[item.status] = (bucket[item.status] || 0) + 1;
    totals[item.kind] = bucket;
  }

  if (!dryRun) {
    for (const item of reconItems) {
      await upsertReconItem(item);
    }
    await insertReconRun({
      fromTs: from.toISOString(),
      toTs: to.toISOString(),
      totals,
      status: 'completed',
      actorUserId,
      actorRole,
      requestId,
    });
    await logAdminAction({
      req: { user: { id: actorUserId, role: actorRole }, requestId },
      action: 'recon_run_completed',
      resource_type: 'reconciliation',
      resource_id: `${from.toISOString()}_${to.toISOString()}`,
      payload: totals,
    });
  } else {
    await logAdminAction({
      req: { user: { id: actorUserId, role: actorRole }, requestId },
      action: 'recon_run_dry',
      resource_type: 'reconciliation',
      resource_id: `${from.toISOString()}_${to.toISOString()}`,
      payload: totals,
    });
  }

  const exceptions = reconItems.filter((r) => r.status !== 'matched');

  const payoutsMissingProviderRefRes = await pool.query(
    `
      select id,
             wallet_id,
             amount,
             status,
             mpesa_transaction_id as provider_reference
      from withdrawals
      where status = 'SUCCESS'
        and (mpesa_transaction_id is null or mpesa_transaction_id = '')
      order by created_at desc
      limit 100
    `,
  );
  const driftRes = await pool.query(
    `
      select wallet_id, wallet_balance, ledger_balance, drift
      from wallet_balances_mv
      where abs(drift) > 0.009
      limit 100
    `,
  );
  const staleHoldsRes = await pool.query(
    `
      select id, wallet_id, amount, reference_type, reference_id, created_at
      from wallet_holds
      where status = 'active'
        and created_at < now() - interval '1 hour'
      order by created_at asc
      limit 100
    `,
  );
  const stuckProcessingRes = await pool.query(
    `
      select id,
             wallet_id,
             amount,
             updated_at as processing_started_at
      from withdrawals
      where status = 'PROCESSING'
        and updated_at < now() - interval '10 minutes'
      limit 100
    `,
  );

  return {
    ok: true,
    totals,
    exceptions: exceptions.slice(0, 20),
    payouts_missing_provider_ref: payoutsMissingProviderRefRes.rows || [],
    wallet_balance_drift: driftRes.rows || [],
    active_holds_stale: staleHoldsRes.rows || [],
    payouts_processing_stuck: stuckProcessingRes.rows || [],
  };
}

module.exports = {
  runReconciliation,
  computeMatches,
};
