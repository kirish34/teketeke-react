const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../supabase');
const pool = require('../db/pool');
const { upsertAppUserContext, normalizeEffectiveRole } = require('../services/appUserContext.service');
const { getSaccoContext } = require('../services/saccoContext.service');
const {
  creditFareWithFees,
  creditFareWithFeesByWalletId,
  creditWallet,
  createWalletRecord,
  registerWalletForEntity,
} = require('../wallet/wallet.service');
const { runDailyReconciliation } = require('../services/reconciliation.service');
const {
  normalizeRef,
  resolveWalletByRef,
  ensurePlateAlias,
  ensurePaybillAlias,
  isPlateRef,
} = require('../wallet/wallet.aliases');
const { validatePaybillCode } = require('../wallet/paybillCode.util');
const { requireUser } = require('../middleware/auth');
const { requireSystemOrSuper, requireSuperOnly } = require('../middleware/requireAdmin');
const { normalizeMsisdn, maskMsisdn, extractMsisdnFromRaw, safeDisplayMsisdn } = require('../utils/msisdn');
const { logAdminAction } = require('../services/audit.service');
const { enqueueJob, isQueueEnabled, getQueue } = require('../queues/queue');
const { runReconciliation } = require('../services/reconciliation.service');
const { ensureIdempotent, logCallbackAudit, safeAck } = require('../services/callbackHardening.service');
const { shouldQuarantine, quarantineOperation } = require('../services/quarantine.service');
const router = express.Router();

router.use(requireSystemOrSuper);

const allowReplayDrill =
  (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') ||
  String(process.env.ENABLE_REPLAY_DRILL || '').toLowerCase() === 'true';

function parseDateRange(query = {}) {
  const range = (query.range || '').toLowerCase();
  const now = new Date();
  let from;
  let to;

  const toParam = query.to ? new Date(query.to) : null;
  const fromParam = query.from ? new Date(query.from) : null;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  if (range === 'today') {
    from = todayStart;
    to = todayEnd;
  } else if (range === 'week') {
    const day = now.getDay(); // 0 = Sun, 1 = Mon
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    from = monday;
    to = todayEnd;
  } else if (range === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    first.setHours(0, 0, 0, 0);
    from = first;
    to = todayEnd;
  } else {
    from = fromParam && !Number.isNaN(fromParam.getTime()) ? fromParam : todayStart;
    to = toParam && !Number.isNaN(toParam.getTime()) ? toParam : todayEnd;
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function normalizeDateBounds(fromRaw, toRaw) {
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const dateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (from && Number.isNaN(from.getTime())) return { from: null, to: null };
  if (to && Number.isNaN(to.getTime())) return { from: null, to: null };

  if (from && dateOnly(fromRaw)) from.setHours(0, 0, 0, 0);
  if (to && dateOnly(toRaw)) to.setHours(23, 59, 59, 999);

  return { from, to };
}

function normalizeDateOnly(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function formatDateISO(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function defaultDateOnlyRange(days = 7) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - Math.max(days - 1, 0));
  return {
    from: formatDateISO(start),
    to: formatDateISO(today),
  };
}

function deriveNumericRef(...values) {
  for (const v of values) {
    if (!v) continue;
    const digits = String(v).match(/\d+/g);
    if (digits && digits.length) {
      const num = Number(digits.join('').slice(-6));
      if (num > 0) return num;
    }
  }
  return Date.now() % 100000;
}

const PAYBILL_KEY_BY_KIND = {
  SACCO_DAILY_FEE: '30',
  SACCO_LOAN: '31',
  SACCO_SAVINGS: '32',
  MATATU_OWNER: '10',
  MATATU_VEHICLE: '11',
  TAXI_DRIVER: '40',
  BODA_RIDER: '50',
};

// Simple ping for UI testing
router.get('/ping', (_req,res)=> res.json({ ok:true }));

function mapC2bRow(row) {
  const normalized =
    row.msisdn_normalized ||
    normalizeMsisdn(row.msisdn) ||
    extractMsisdnFromRaw(row.raw) ||
    null;
  const display = safeDisplayMsisdn({
    display_msisdn: row.display_msisdn,
    msisdn_normalized: normalized,
  });
  const { raw, msisdn: _msisdn, ...rest } = row;
  return {
    ...rest,
    display_msisdn: row.display_msisdn || null,
    display_msisdn_safe: display,
    msisdn_normalized: normalized,
  };
}

// Overview
router.get('/system-overview', async (_req, res) => {
  try {
    const [
      { count: saccos },
      { count: shuttles },
      { count: taxis },
      { count: bodas },
      { count: staff },
      { data: txTodayRows },
    ] = await Promise.all([
      supabaseAdmin.from('saccos').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('shuttles').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('matatus')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_type', 'TAXI'),
      supabaseAdmin
        .from('matatus')
        .select('*', { count: 'exact', head: true })
        .or('vehicle_type.eq.BODABODA,vehicle_type.eq.BODA'),
      supabaseAdmin.from('staff_profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin.rpc('count_tx_today'),
    ]);
    const { data: poolAvail } = await supabaseAdmin.from('ussd_pool').select('id').eq('status','AVAILABLE');
    const { data: poolAll }   = await supabaseAdmin.from('ussd_pool').select('id', { count: 'exact' });
    res.json({
      counts: {
        saccos: saccos || 0,
        matatus: shuttles || 0,
        taxis: taxis || 0,
        bodas: bodas || 0,
        cashiers: staff || 0,
        tx_today: txTodayRows || 0,
      },
      ussd_pool: {
        available: (poolAvail || []).length,
        total: poolAll?.length || 0,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/audit', async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 100);
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_audit_logs')
      .select('*')
      .eq('domain', 'teketeke')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, items: data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Staging-only: replay callback drill to test idempotency/ignore paths
router.post('/dev/replay-callback', async (req, res) => {
  if (!allowReplayDrill) {
    return res.status(404).json({ ok: false, error: 'not_enabled' });
  }
  try {
    const kind = String(req.body?.kind || '').trim().toUpperCase();
    const payload = req.body?.payload || {};
    if (!kind) return res.status(400).json({ ok: false, error: 'kind required' });
    const key = payload.TransID || payload.transId || payload.receipt || payload.checkout_request_id || payload.id || null;
    const idem = await ensureIdempotent({ kind, key: key || `DRILL:${kind}:${Date.now()}`, payload });
    await logCallbackAudit({
      req,
      key: key || null,
      kind,
      result: idem.firstTime ? 'accepted' : 'ignored',
      reason: idem.firstTime ? null : 'duplicate',
    });
    return res.json({
      ok: true,
      result: idem.firstTime ? 'accepted' : 'duplicate_ignored',
      idempotency_key: key,
      store: idem.store,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Reconciliation endpoints
router.post('/reconciliation/run', async (req, res) => {
  const from = req.body?.from || req.body?.fromTs || req.query?.from || null;
  const to = req.body?.to || req.body?.toTs || req.query?.to || null;
  const mode = req.body?.mode === 'dry' ? 'dry' : 'write';
  if (!from || !to) return res.status(400).json({ ok: false, error: 'from and to required' });
  try {
    const result = await runReconciliation({
      fromTs: from,
      toTs: to,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || null,
      requestId: req.requestId || null,
      mode,
    });
    return res.json({
      ok: true,
      totals: result.totals,
      sample_exceptions: result.exceptions,
    });
  } catch (err) {
    await logAdminAction({
      req,
      action: 'recon_run_failed',
      resource_type: 'reconciliation',
      resource_id: `${from}_${to}`,
      payload: { error: err.message },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/reconciliation/runs', async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  try {
    const { rows } = await pool.query(
      `
        WITH runs AS (
          SELECT
            id,
            created_at,
            from_ts,
            to_ts,
            status,
            actor_user_id,
            actor_role,
            details
          FROM public.recon_runs
          WHERE domain = $1
          ORDER BY created_at DESC
          LIMIT $2
        ),
        totals_cte AS (
          SELECT COUNT(*) AS total
          FROM public.recon_runs
          WHERE domain = $1
        )
        SELECT jsonb_build_object(
          'ok', true,
          'totals', (SELECT to_jsonb(totals_cte) FROM totals_cte),
          'items', (SELECT COALESCE(jsonb_agg(to_jsonb(runs)), '[]'::jsonb) FROM runs)
        ) AS payload;
      `,
      ['teketeke', limit],
    );
    const payload = rows?.[0]?.payload || { ok: true, totals: { total: 0 }, items: [] };
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/reconciliation/exceptions', async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;
  const status = String(req.query.status || '').trim();
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  const where = ['domain = $1', "status <> 'matched'"];
  const params = ['teketeke'];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (from && !Number.isNaN(from.getTime())) {
    params.push(from.toISOString());
    where.push(`created_at >= $${params.length}`);
  }
  if (to && !Number.isNaN(to.getTime())) {
    params.push(to.toISOString());
    where.push(`created_at <= $${params.length}`);
  }
  const whereClause = `WHERE ${where.join(' AND ')}`;
  try {
    const { rows } = await pool.query(
      `
        SELECT id, kind, provider_ref, internal_ref, amount, status, details, created_at
        FROM recon_items
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1}
      `,
      [...params, limit],
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/reconciliation/override', requireSuperOnly, async (req, res) => {
  const { kind, provider_ref, status, note } = req.body || {};
  if (!kind || !provider_ref || !status) {
    return res.status(400).json({ ok: false, error: 'kind, provider_ref, status required' });
  }
  try {
    await pool.query(
      `
        INSERT INTO recon_items (domain, kind, provider_ref, status, details, last_seen_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (domain, kind, provider_ref) DO UPDATE
          SET status = EXCLUDED.status,
              details = EXCLUDED.details,
              last_seen_at = now(),
              resolved = true
      `,
      ['teketeke', kind, provider_ref, status, { override: true, note: note || null }],
    );
    await logAdminAction({
      req,
      action: 'recon_override',
      resource_type: 'reconciliation',
      resource_id: provider_ref,
      payload: { kind, status, note: note || null },
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Callback audit summary (callback health)
router.get('/callback-audit/summary', async (req, res) => {
  const fromDate = req.query.from ? new Date(req.query.from) : null;
  const toDate = req.query.to ? new Date(req.query.to) : null;
  const fromTs = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate.toISOString() : null;
  const toTs = toDate && !Number.isNaN(toDate.getTime()) ? toDate.toISOString() : null;
  const params = [fromTs, toTs];

  try {
    const { rows } = await pool.query(
      `
        WITH filtered AS (
          SELECT created_at, COALESCE(result, meta->>'result', 'unknown') AS result
          FROM public.admin_audit_logs
          WHERE ($1::timestamptz IS NULL OR created_at >= $1)
            AND ($2::timestamptz IS NULL OR created_at <= $2)
            AND domain = 'teketeke'
            AND action = 'mpesa_callback'
        ),
        totals_cte AS (
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE result = 'success') AS success,
            COUNT(*) FILTER (WHERE result = 'failure') AS failure
          FROM filtered
        ),
        by_result AS (
          SELECT result, COUNT(*) AS count
          FROM filtered
          GROUP BY result
          ORDER BY count DESC
        )
        SELECT jsonb_build_object(
          'ok', true,
          'from', $1,
          'to', $2,
          'totals', (SELECT to_jsonb(totals_cte) FROM totals_cte),
          'by_result', (SELECT COALESCE(jsonb_agg(to_jsonb(by_result)), '[]'::jsonb) FROM by_result)
        ) AS summary
      `,
      params,
    );
    const summary = rows?.[0]?.summary || { ok: true, totals: {}, by_result: [] };
    return res.json(summary);
  } catch (err) {
    // If the table is missing or search_path is wrong, surface a clear error
    if (err?.message && err.message.includes('does not exist')) {
      return res.status(503).json({
        ok: false,
        error: 'RECON_SCHEMA_MISSING',
        message: 'callback audit table not deployed in this environment',
      });
    }
    return res.status(500).json({ ok: false, error: err.message || 'callback audit summary failed' });
  }
});

// Callback audit events (recent failures/ignored/etc.)
router.get('/callback-audit/events', async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const resultFilter = String(req.query.result || '').trim().toLowerCase();

  const params = ['teketeke'];
  const where = ['domain = $1', "action = 'mpesa_callback'"];
  if (resultFilter) {
    params.push(resultFilter);
    where.push(`COALESCE(result, meta->>'result') = $${params.length}`);
  }
  const whereClause = `WHERE ${where.join(' AND ')}`;

  try {
    const { rows } = await pool.query(
      `
        SELECT
          created_at,
          COALESCE(resource_type, entity_type) AS kind,
          COALESCE(resource_id, entity_id) AS resource_id,
          COALESCE(meta, details, '{}'::jsonb) AS payload,
          COALESCE(result, meta->>'result') AS result
        FROM admin_audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1}
      `,
      [...params, limit],
    );
    return res.json({ ok: true, items: rows || [], limit });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Queue job status endpoints
router.get('/jobs/:id', async (req, res) => {
  if (!isQueueEnabled()) return res.status(404).json({ ok: false, error: 'queue_disabled' });
  const jobId = req.params.id;
  if (!jobId) return res.status(400).json({ ok: false, error: 'job id required' });
  try {
    const queue = getQueue();
    const job = await queue.getJob(jobId);
    if (!job) return res.status(404).json({ ok: false, error: 'job_not_found' });
    const state = await job.getState();
    return res.json({
      ok: true,
      id: job.id,
      name: job.name,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      returnvalue: job.returnvalue,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/jobs', async (req, res) => {
  if (!isQueueEnabled()) return res.status(404).json({ ok: false, error: 'queue_disabled' });
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const name = String(req.query.name || '').trim();
  try {
    const queue = getQueue();
    const jobs = await queue.getJobs(
      ['waiting', 'active', 'completed', 'failed', 'delayed'],
      0,
      limit - 1,
      true,
    );
    const filtered = name ? jobs.filter((j) => j.name === name) : jobs;
    return res.json({
      ok: true,
      items: filtered.map((job) => ({
        id: job.id,
        name: job.name,
        state: job.finishedOn ? 'completed' : job.failedReason ? 'failed' : job.opts?.state || 'pending',
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      })),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Manual wallet credit (admin adjustment)
router.post('/wallets/credit', async (req, res) => {
  try {
    const {
      virtualAccountCode,
      amount,
      source,
      sourceRef,
      description,
    } = req.body || {};
    const qDecision = await shouldQuarantine({
      operationType: 'WALLET_CREDIT',
      entityType: 'WALLET',
      entityId: virtualAccountCode || null,
      db: pool,
    });
    if (qDecision.quarantine) {
      const record = await quarantineOperation({
        operationType: 'WALLET_CREDIT',
        operationId: virtualAccountCode || 'wallet',
        entityType: 'WALLET',
        entityId: virtualAccountCode || null,
        reason: qDecision.reason || 'quarantined',
        source: qDecision.alert_id ? 'FRAUD_ALERT' : 'MANUAL',
        severity: qDecision.severity || 'high',
        alert_id: qDecision.alert_id || null,
        incident_id: qDecision.incident_id || null,
        payload: { virtualAccountCode, amount, source, sourceRef, description },
        actorReq: req,
        db: pool,
      });
      await logAdminAction({
        req,
        action: 'wallet_credit_quarantined',
        resource_type: 'wallet',
        resource_id: virtualAccountCode || null,
        payload: { amount, source: source || 'ADMIN_ADJUST', quarantine_id: record?.id || null },
      });
      return res.status(202).json({ ok: true, quarantined: true, quarantine_id: record?.id || null });
    }
    const result = await creditWallet({
      virtualAccountCode,
      amount,
      source: source || 'ADMIN_ADJUST',
      sourceRef: sourceRef || null,
      description: description || null,
    });
    await logAdminAction({
      req,
      action: 'wallet_credit',
      resource_type: 'wallet',
      resource_id: virtualAccountCode || null,
      payload: { amount, source: source || 'ADMIN_ADJUST', sourceRef: sourceRef || null },
    });
    res.json({ ok: true, message: 'Wallet credited', data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Credit failed' });
  }
});

// Platform finance overview (all saccos)
router.get('/platform-overview', async (req, res) => {
  const range = parseDateRange(req.query);
  try {
    const { rows } = await pool.query(
      `
        SELECT
          COALESCE((
            SELECT SUM(wl.amount)
            FROM wallet_ledger wl
            JOIN wallets w ON w.id = wl.wallet_id
            WHERE wl.direction = 'CREDIT'
              AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
              AND w.entity_type IN ('MATATU','TAXI','BODA','BODABODA')
              AND wl.created_at BETWEEN $1 AND $2
          ), 0) AS matatu_net,
          COALESCE((
            SELECT SUM(wl.amount)
            FROM wallet_ledger wl
            JOIN wallets w ON w.id = wl.wallet_id
            WHERE wl.direction = 'CREDIT'
              AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
              AND w.entity_type = 'SACCO'
              AND wl.created_at BETWEEN $1 AND $2
          ), 0) AS sacco_fee_income,
          COALESCE((
            SELECT SUM(wl.amount)
            FROM wallet_ledger wl
            JOIN wallets w ON w.id = wl.wallet_id
            WHERE wl.direction = 'CREDIT'
              AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
              AND w.entity_type = 'SYSTEM'
              AND wl.created_at BETWEEN $1 AND $2
          ), 0) AS platform_fee_income
      `,
      [range.from, range.to]
    );

    const row = rows[0] || {};
    const matatu_net = Number(row.matatu_net || 0);
    const sacco_fee_income = Number(row.sacco_fee_income || 0);
    const platform_fee_income = Number(row.platform_fee_income || 0);
    const gross_fares = matatu_net + sacco_fee_income + platform_fee_income;

    res.json({
      period: range,
      totals: {
        gross_fares,
        matatu_net,
        sacco_fee_income,
        platform_fee_income,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Platform sacco performance summary
router.get('/platform-saccos-summary', async (req, res) => {
  const range = parseDateRange(req.query);
  try {
    const { rows } = await pool.query(
      `
        WITH matatu_net AS (
          SELECT
            m.sacco_id,
            COUNT(DISTINCT m.id) AS matatus,
            COALESCE(SUM(wl.amount), 0) AS matatu_net
          FROM matatus m
          LEFT JOIN wallets w ON w.entity_type = 'MATATU' AND w.entity_id = m.id
          LEFT JOIN wallet_ledger wl
            ON wl.wallet_id = w.id
           AND wl.direction = 'CREDIT'
           AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
           AND wl.created_at BETWEEN $1 AND $2
          GROUP BY m.sacco_id
        ),
        sacco_fees AS (
          SELECT
            w.sacco_id AS sacco_id,
            COALESCE(SUM(wl.amount), 0) AS sacco_fee_income
          FROM wallets w
          LEFT JOIN wallet_ledger wl
            ON wl.wallet_id = w.id
           AND wl.direction = 'CREDIT'
           AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
           AND wl.created_at BETWEEN $1 AND $2
          WHERE w.entity_type = 'SACCO'
          GROUP BY w.sacco_id
        )
        SELECT
          s.id AS sacco_id,
          s.name AS sacco_name,
          COALESCE(mn.matatus, 0)::int AS matatus,
          COALESCE(mn.matatu_net, 0) AS matatu_net,
          COALESCE(sf.sacco_fee_income, 0) AS sacco_fee_income,
          (COALESCE(mn.matatu_net, 0) + COALESCE(sf.sacco_fee_income, 0)) AS gross_fares,
          'ACTIVE' AS status
        FROM saccos s
        LEFT JOIN matatu_net mn ON mn.sacco_id = s.id
        LEFT JOIN sacco_fees sf ON sf.sacco_id = s.id
        ORDER BY gross_fares DESC, sacco_name ASC
      `,
      [range.from, range.to]
    );

    res.json({
      period: range,
      items: rows || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Withdrawals monitor
router.get('/withdrawals', async (req, res) => {
  const range = parseDateRange(req.query);
  const status = req.query.status || null;
  try {
    const params = [range.from, range.to];
    let statusClause = '';
    if (status) {
      statusClause = 'AND w.status = $3';
      params.push(status);
    }

    const { rows } = await pool.query(
      `
        SELECT
          w.id,
          w.created_at,
          w.amount,
          w.phone_number,
          w.status,
          w.failure_reason,
          w.mpesa_transaction_id,
          w.mpesa_conversation_id,
          wal.virtual_account_code,
          wal.entity_type,
          wal.entity_id
        FROM withdrawals w
        JOIN wallets wal ON wal.id = w.wallet_id
        WHERE w.created_at BETWEEN $1 AND $2
        ${statusClause}
        ORDER BY w.created_at DESC
        LIMIT 200
      `,
      params
    );

    res.json({
      period: range,
      items: rows || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// C2B payments log
router.get('/c2b-payments', async (req, res) => {
  const statusRaw = String(req.query.status || '').trim();
  const statusLower = statusRaw.toLowerCase();
  const q = String(req.query.q || '').trim();
  const { from, to } = normalizeDateBounds(req.query.from, req.query.to);
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offsetRaw = Number(req.query.offset);
  const pageRaw = Number(req.query.page);
  let offset = 0;
  if (Number.isFinite(offsetRaw) && offsetRaw >= 0) {
    offset = offsetRaw;
  } else if (Number.isFinite(pageRaw) && pageRaw > 1) {
    offset = (pageRaw - 1) * limit;
  }

  const params = [];
  const where = [];
  let normalizedStatus = null;
  if (statusLower === 'processed') normalizedStatus = 'CREDITED';
  if (statusLower === 'pending') normalizedStatus = 'RECEIVED';
  if (['RECEIVED', 'CREDITED', 'REJECTED', 'QUARANTINED'].includes(statusRaw.toUpperCase())) {
    normalizedStatus = statusRaw.toUpperCase();
  }
  if (normalizedStatus) {
    params.push(normalizedStatus);
    where.push(`status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    where.push(
      `(receipt ILIKE $${idx} OR msisdn ILIKE $${idx} OR account_reference ILIKE $${idx} OR paybill_number ILIKE $${idx})`
    );
  }
  if (from) {
    params.push(from.toISOString());
    where.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`created_at <= $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const countRes = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM mpesa_c2b_payments
        ${whereClause}
      `,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);
    const { rows } = await pool.query(
      `
        SELECT
          id,
          receipt,
          msisdn,
          msisdn_normalized,
          display_msisdn,
          amount,
          paybill_number,
          account_reference,
          status,
          created_at,
          raw
        FROM mpesa_c2b_payments
        ${whereClause}
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params
    );
    const items = (rows || []).map(mapC2bRow);
    res.json({ ok: true, items, total, limit, offset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Wallet PayBill/Plate aliases (admin UI helper)
router.get('/paybill-codes', async (req, res) => {
  const entityType = String(req.query.entity_type || '').trim().toUpperCase();
  try {
    const params = [];
    const where = [`(wa.is_active = true OR wa.id IS NULL)`, `(wa.alias_type IN ('PAYBILL_CODE', 'PLATE') OR wa.alias_type IS NULL)`];
    if (entityType) {
      params.push(entityType);
      where.push(`w.entity_type = $${params.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `
        SELECT
          w.id AS wallet_id,
          w.entity_type,
          w.entity_id,
          w.wallet_kind,
          w.sacco_id,
          w.matatu_id,
          w.wallet_code,
          w.virtual_account_code,
          wa.alias,
          wa.alias_type
        FROM wallets w
        LEFT JOIN wallet_aliases wa
          ON wa.wallet_id = w.id
         AND wa.is_active = true
         AND wa.alias_type IN ('PAYBILL_CODE', 'PLATE')
        ${whereClause}
        ORDER BY w.entity_type, w.entity_id
      `,
      params
    );
    const deriveType = (row) => {
      const kind = String(row.wallet_kind || '').toUpperCase();
      if (kind === 'TAXI_DRIVER') return 'TAXI';
      if (kind === 'BODA_RIDER') return 'BODA';
      if (kind.startsWith('SACCO_')) return 'SACCO';
      if (kind.startsWith('MATATU_')) return 'MATATU';
      if (row.entity_type) return String(row.entity_type).toUpperCase();
      return null;
    };

    const items = (rows || []).map((row) => ({
      ...row,
      entity_type: deriveType(row),
    }));

    // Ensure every wallet has a paybill entry (fallback to wallet code)
    const byWallet = new Map();
    items.forEach((row) => {
      const list = byWallet.get(row.wallet_id) || [];
      list.push(row);
      byWallet.set(row.wallet_id, list);
    });
    byWallet.forEach((list, walletId) => {
      const hasPaybill = list.some((r) => r.alias_type === 'PAYBILL_CODE' && r.alias);
      if (!hasPaybill && list.length) {
        const base = list[0];
        items.push({
          ...base,
          alias: base.wallet_code || base.virtual_account_code || null,
          alias_type: 'PAYBILL_CODE',
        });
      }
    });

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load paybill codes' });
  }
});

// Fetch raw C2B payload
router.get('/c2b-payments/:id/raw', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rows } = await pool.query(
      `
        SELECT raw
        FROM mpesa_c2b_payments
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, payload: rows[0].raw });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Reprocess a C2B payment
router.post('/c2b-payments/:id/reprocess', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rows } = await pool.query(
      `
        SELECT
          id,
          receipt,
          msisdn,
          amount,
          account_reference,
          paybill_number,
          status
        FROM mpesa_c2b_payments
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    const row = rows[0];
    if (row.status !== 'RECEIVED') {
      return res.status(400).json({ ok: false, error: 'payment not in RECEIVED state' });
    }

    const expectedPaybill = '4814003';
    if (String(row.paybill_number || '') !== expectedPaybill) {
      await pool.query(`UPDATE mpesa_c2b_payments SET status = 'QUARANTINED' WHERE id = $1 AND status = 'RECEIVED'`, [
        row.id,
      ]);
      return res.status(400).json({ ok: false, error: 'paybill mismatch' });
    }

    const normalizedRef = normalizeRef(row.account_reference);
    if (!validatePaybillCode(normalizedRef)) {
      await pool.query(`UPDATE mpesa_c2b_payments SET status = 'QUARANTINED' WHERE id = $1 AND status = 'RECEIVED'`, [
        row.id,
      ]);
      return res.status(400).json({ ok: false, error: 'invalid account reference' });
    }

    const amount = Number(row.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      await pool.query(`UPDATE mpesa_c2b_payments SET status = 'REJECTED' WHERE id = $1 AND status = 'RECEIVED'`, [
        row.id,
      ]);
      return res.status(400).json({ ok: false, error: 'invalid amount' });
    }

    const walletId = await resolveWalletByRef(normalizedRef);
    if (!walletId) {
      await pool.query(`UPDATE mpesa_c2b_payments SET status = 'QUARANTINED' WHERE id = $1 AND status = 'RECEIVED'`, [
        row.id,
      ]);
      return res.status(400).json({ ok: false, error: 'unknown account reference' });
    }

    const sourceRef = row.receipt || String(row.id);
    const existing = await pool.query(
      `
        SELECT id
        FROM wallet_ledger
        WHERE reference_type = 'MPESA_C2B' AND reference_id = $1
        LIMIT 1
      `,
      [String(row.id)]
    );
    if (existing.rows.length) {
      await pool.query(`UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status = 'RECEIVED'`, [
        row.id,
      ]);
      return res.json({ ok: true, message: 'Already credited; marked credited' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const payerDisplay = maskMsisdn(normalizeMsisdn(row.msisdn)) || 'unknown';
      const result = await creditFareWithFeesByWalletId({
        walletId,
        amount,
        source: 'MPESA_C2B',
        sourceRef,
        referenceId: row.id,
        referenceType: 'MPESA_C2B',
        description: `M-Pesa fare from ${payerDisplay}`,
        client,
      });
      const updated = await client.query(
        `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status = 'RECEIVED'`,
        [row.id]
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'payment status changed; retry' });
      }
      await client.query('COMMIT');
      await logAdminAction({
        req,
        action: 'c2b_reprocess',
        resource_type: 'c2b_payment',
        resource_id: row.id,
        payload: { amount, walletId, receipt: row.receipt || null },
      });
      return res.json({ ok: true, message: 'Reprocessed', data: result });
    } catch (err) {
      await client.query('ROLLBACK');
      await pool.query(`UPDATE mpesa_c2b_payments SET status = 'REJECTED' WHERE id = $1 AND status = 'RECEIVED'`, [
        row.id,
      ]);
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Daily reconciliation (admin-triggered)
router.post('/reconciliation/run', async (req, res) => {
  const date = normalizeDateOnly(req.query.date || req.body?.date || null);
  try {
    const result = await runDailyReconciliation({ date: date || undefined });
    await logAdminAction({
      req,
      action: 'reconciliation_run',
      resource_type: 'reconciliation',
      resource_id: date || 'latest',
      payload: {},
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/reconciliation', async (req, res) => {
  const defaults = defaultDateOnlyRange(14);
  const from = normalizeDateOnly(req.query.from) || defaults.from;
  const to = normalizeDateOnly(req.query.to) || defaults.to;
  try {
    const paybillRes = await pool.query(
      `
        SELECT
          id,
          date,
          paybill_number,
          credited_total,
          credited_count,
          quarantined_total,
          quarantined_count,
          rejected_total,
          rejected_count,
          created_at,
          updated_at
        FROM reconciliation_daily
        WHERE date >= $1 AND date <= $2
        ORDER BY date DESC
      `,
      [from, to]
    );
    const channelRes = await pool.query(
      `
        SELECT
          id,
          date,
          channel,
          paybill_number,
          credited_total,
          credited_count,
          quarantined_total,
          quarantined_count,
          rejected_total,
          rejected_count,
          created_at,
          updated_at
        FROM reconciliation_daily_channels
        WHERE date >= $1 AND date <= $2
        ORDER BY date DESC, channel
      `,
      [from, to]
    );

    const paybillRows = paybillRes.rows || [];
    const channelRows = channelRes.rows || [];

    const c2bByDate = {};
    paybillRows.forEach((row) => {
      if (!row?.date) return;
      c2bByDate[row.date] = {
        credited_total: Number(row.credited_total || 0),
        credited_count: Number(row.credited_count || 0),
        quarantined_total: Number(row.quarantined_total || 0),
        quarantined_count: Number(row.quarantined_count || 0),
        rejected_total: Number(row.rejected_total || 0),
        rejected_count: Number(row.rejected_count || 0),
      };
    });

    const stkByDate = {};
    channelRows.forEach((row) => {
      if (!row?.date || row.channel !== 'STK') return;
      stkByDate[row.date] = {
        credited_total: Number(row.credited_total || 0),
        credited_count: Number(row.credited_count || 0),
        quarantined_total: Number(row.quarantined_total || 0),
        quarantined_count: Number(row.quarantined_count || 0),
        rejected_total: Number(row.rejected_total || 0),
        rejected_count: Number(row.rejected_count || 0),
      };
    });

    const dateSet = new Set([
      ...paybillRows.map((row) => row.date).filter(Boolean),
      ...Object.keys(stkByDate),
    ]);

    const combined = Array.from(dateSet)
      .map((date) => {
        const c2b = c2bByDate[date] || {};
        const stk = stkByDate[date] || {};
        return {
          date,
          credited_total: Number(c2b.credited_total || 0) + Number(stk.credited_total || 0),
          credited_count: Number(c2b.credited_count || 0) + Number(stk.credited_count || 0),
          quarantined_total: Number(c2b.quarantined_total || 0) + Number(stk.quarantined_total || 0),
          quarantined_count: Number(c2b.quarantined_count || 0) + Number(stk.quarantined_count || 0),
          rejected_total: Number(c2b.rejected_total || 0) + Number(stk.rejected_total || 0),
          rejected_count: Number(c2b.rejected_count || 0) + Number(stk.rejected_count || 0),
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    res.json({ ok: true, paybill_c2b: paybillRows, channels: channelRows, combined });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Quarantine listing (admin)
router.get('/c2b/quarantine', async (req, res) => {
  const status = String(req.query.status || 'QUARANTINED').trim().toUpperCase();
  const riskLevel = String(req.query.risk_level || '').trim().toUpperCase();
  const flag = String(req.query.flag || '').trim().toUpperCase();
  const q = String(req.query.q || '').trim();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  const params = [];
  const where = [];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (riskLevel) {
    params.push(riskLevel);
    where.push(`risk_level = $${params.length}`);
  }
  if (flag) {
    params.push(flag);
    where.push(`risk_flags ? $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    where.push(
      `(receipt ILIKE $${idx} OR msisdn ILIKE $${idx} OR account_reference ILIKE $${idx})`
    );
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const countRes = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM mpesa_c2b_payments
        ${whereClause}
      `,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);
    const { rows } = await pool.query(
      `
        SELECT
          id,
          receipt,
          msisdn,
          msisdn_normalized,
          display_msisdn,
          amount,
          paybill_number,
          account_reference,
          status,
          risk_level,
          risk_score,
          risk_flags,
          created_at,
          raw
        FROM mpesa_c2b_payments
        ${whereClause}
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params
    );
    const items = (rows || []).map(mapC2bRow);
    res.json({ ok: true, items, total, limit, offset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

async function auditC2bAction({ client, adminUserId, paymentId, action, note, meta }) {
  await client.query(
    `
      INSERT INTO c2b_actions_audit
        (admin_user_id, payment_id, action, note, meta)
      VALUES
        ($1, $2, $3, $4, $5)
    `,
    [adminUserId || null, paymentId, action, note || null, meta || {}]
  );
}

router.post('/c2b/:id/resolve', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });

  const action = String(req.body?.action || '').trim().toUpperCase();
  const walletIdInput = req.body?.wallet_id || null;
  const note = req.body?.note || null;
  if (!['CREDIT', 'REJECT'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'action must be CREDIT or REJECT' });
  }

  const adminUserId = req.user?.id || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const paymentRes = await client.query(
      `
        SELECT id, status, receipt, msisdn, amount, account_reference
        FROM mpesa_c2b_payments
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );
    if (!paymentRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'payment not found' });
    }

    const payment = paymentRes.rows[0];
    if (action === 'REJECT') {
      if (payment.status === 'CREDITED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'cannot reject a credited payment' });
      }
      if (payment.status === 'REJECTED') {
        await auditC2bAction({
          client,
          adminUserId,
          paymentId: id,
          action: 'REJECT',
        note,
        meta: { previous_status: payment.status, idempotent: true },
      });
      await client.query('COMMIT');
      await logAdminAction({
        req,
        action: 'c2b_resolve_reject',
        resource_type: 'c2b_payment',
        resource_id: id,
        payload: { idempotent: true, previous_status: payment.status },
      });
      return res.json({ ok: true, message: 'Already rejected' });
    }
      const updated = await client.query(
        `UPDATE mpesa_c2b_payments SET status = 'REJECTED' WHERE id = $1 AND status IN ('RECEIVED', 'QUARANTINED')`,
        [id]
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'payment status changed; retry' });
      }
      await auditC2bAction({
        client,
        adminUserId,
        paymentId: id,
        action: 'REJECT',
        note,
        meta: { previous_status: payment.status },
      });
      await client.query('COMMIT');
      await logAdminAction({
        req,
        action: 'c2b_resolve_reject',
        resource_type: 'c2b_payment',
        resource_id: id,
        payload: { previous_status: payment.status },
      });
      return res.json({ ok: true, message: 'Payment rejected' });
    }

    if (payment.status === 'CREDITED') {
      await auditC2bAction({
        client,
        adminUserId,
        paymentId: id,
        action: 'CREDIT',
        note,
        meta: { previous_status: payment.status, idempotent: true },
      });
      await client.query('COMMIT');
      await logAdminAction({
        req,
        action: 'c2b_resolve_credit',
        resource_type: 'c2b_payment',
        resource_id: id,
        payload: { idempotent: true, previous_status: payment.status },
      });
      return res.json({ ok: true, message: 'Already credited' });
    }

    if (payment.status === 'REJECTED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'cannot credit a rejected payment' });
    }

    let resolvedWalletId = walletIdInput;
    if (!resolvedWalletId) {
      const normalized = normalizeRef(payment.account_reference || '');
      resolvedWalletId = await resolveWalletByRef(normalized, { client });
    }

    if (!resolvedWalletId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'wallet_id required or alias unresolved' });
    }

    const amount = Number(payment.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'invalid amount' });
    }

    const sourceRef = payment.receipt || String(payment.id);
    const existingTx = await client.query(
      `
        SELECT id
        FROM wallet_ledger
        WHERE reference_type = 'MPESA_C2B' AND reference_id = $1
        LIMIT 1
      `,
      [String(payment.id)]
    );

    if (existingTx.rows.length) {
      await client.query(
        `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status IN ('RECEIVED', 'QUARANTINED')`,
        [id]
      );
      await auditC2bAction({
        client,
        adminUserId,
        paymentId: id,
        action: 'CREDIT',
        note,
        meta: { previous_status: payment.status, idempotent: true },
      });
      await client.query('COMMIT');
      await logAdminAction({
        req,
        action: 'c2b_resolve_credit',
        resource_type: 'c2b_payment',
        resource_id: id,
        payload: { idempotent: true, previous_status: payment.status },
      });
      return res.json({ ok: true, message: 'Already credited (idempotent)' });
    }

    const result = await creditFareWithFeesByWalletId({
      walletId: resolvedWalletId,
      amount,
      source: 'MPESA_C2B',
      sourceRef,
      referenceId: payment.id,
      referenceType: 'MPESA_C2B',
      description: `Manual C2B resolve from ${payment.msisdn || 'unknown'}`,
      client,
    });

    const updated = await client.query(
      `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status IN ('RECEIVED', 'QUARANTINED')`,
      [id]
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'payment status changed; retry' });
    }
    await auditC2bAction({
      client,
      adminUserId,
      paymentId: id,
      action: 'CREDIT',
      note,
      meta: { previous_status: payment.status, wallet_id: resolvedWalletId },
    });
    await client.query('COMMIT');
    await logAdminAction({
      req,
      action: 'c2b_resolve_credit',
      resource_type: 'c2b_payment',
      resource_id: id,
      payload: { wallet_id: resolvedWalletId, amount, receipt: payment.receipt || null },
    });
    return res.json({ ok: true, message: 'Credited', data: result });
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// Ops alerts (admin)
router.get('/ops-alerts', async (req, res) => {
  const severity = String(req.query.severity || '').trim().toUpperCase();
  const type = String(req.query.type || '').trim();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  const params = [];
  const where = [];
  if (severity) {
    params.push(severity);
    where.push(`severity = $${params.length}`);
  }
  if (type) {
    params.push(type);
    where.push(`type = $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const countRes = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM ops_alerts
        ${whereClause}
      `,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);
    const { rows } = await pool.query(
      `
        SELECT
          id,
          created_at,
          type,
          severity,
          entity_type,
          entity_id,
          payment_id,
          message,
          meta
        FROM ops_alerts
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params
    );
    res.json({ ok: true, items: rows || [], total, limit, offset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Saccos
router.get('/saccos', async (req,res)=>{
  let q = supabaseAdmin.from('saccos').select('*').order('created_at',{ascending:false});
  const filter = (req.query.q||'').trim();
  if (filter) q = q.ilike('name', `%${filter}%`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
async function ensureAuthUser(email, password){
  const createRes = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createRes.error) {
    const msg = String(createRes.error.message || createRes.error);
    if (!/already/i.test(msg) && !/exists/i.test(msg) && !/registered/i.test(msg)) {
      throw createRes.error;
    }
    let page = 1;
    while (page <= 50) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      if (!data?.users?.length) break;
      const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
      if (found) return { userId: found.id, created: false };
      page += 1;
    }
    throw new Error('Supabase user ' + email + ' exists but could not be retrieved');
  }
  const userId = createRes.data?.user?.id;
  if (!userId) throw new Error('Failed to resolve created user id');
  return { userId, created: true };
}

const SYSTEM_ADMIN_ROLES = new Set(['SYSTEM_ADMIN', 'SUPER_ADMIN']);

function normalizeSystemAdminRole(role) {
  const r = String(role || '').trim().toUpperCase();
  return SYSTEM_ADMIN_ROLES.has(r) ? r : null;
}

function normalizeSystemAdminPerms(raw, role) {
  const isSuper = normalizeSystemAdminRole(role) === 'SUPER_ADMIN';
  const base = {
    can_finance_act: raw?.can_finance_act !== false,
    can_registry: raw?.can_registry !== false,
    can_monitor: raw?.can_monitor !== false,
    can_alerts: raw?.can_alerts !== false,
    is_active: raw?.is_active !== false,
    full_name: raw?.full_name || null,
    id_number: raw?.id_number || null,
    phone: raw?.phone || null,
  };
  if (isSuper) {
    return {
      ...base,
      can_finance_act: true,
      can_registry: true,
      can_monitor: true,
      can_alerts: true,
      is_active: true,
      full_name: raw?.full_name || null,
      id_number: raw?.id_number || null,
      phone: raw?.phone || null,
      created_at: raw?.created_at || null,
      updated_at: raw?.updated_at || null,
      created_by: raw?.created_by || null,
      created_by_email: raw?.created_by_email || null,
      updated_by: raw?.updated_by || raw?.created_by || null,
      updated_by_email: raw?.updated_by_email || raw?.created_by_email || null,
    };
  }
  return {
    ...base,
    created_at: raw?.created_at || null,
    updated_at: raw?.updated_at || null,
    created_by: raw?.created_by || null,
    created_by_email: raw?.created_by_email || null,
    updated_by: raw?.updated_by || raw?.created_by || null,
    updated_by_email: raw?.updated_by_email || raw?.created_by_email || null,
    full_name: raw?.full_name || null,
    id_number: raw?.id_number || null,
    phone: raw?.phone || null,
  };
}

async function upsertSystemAdminPerms(userId, role, rawPerms, actor = {}) {
  const perms = normalizeSystemAdminPerms(rawPerms, role);
  const actorId = actor?.id || actor?.user_id || null;
  const actorEmail = actor?.email || null;
  let createdBy = perms.created_by || null;
  let createdByEmail = perms.created_by_email || null;

  // Preserve created_by if record exists.
  try {
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('system_admin_permissions')
      .select('created_by, created_by_email')
      .eq('user_id', userId)
      .maybeSingle();
    if (existErr && existErr.code !== 'PGRST116') throw existErr;
    if (existing) {
      createdBy = existing.created_by || createdBy;
      createdByEmail = existing.created_by_email || createdByEmail;
    }
  } catch (err) {
    // ignore lookup failures; best-effort only
  }

  const payload = {
    user_id: userId,
    can_finance_act: perms.can_finance_act,
    can_registry: perms.can_registry,
    can_monitor: perms.can_monitor,
    can_alerts: perms.can_alerts,
    is_active: perms.is_active !== false,
    full_name: perms.full_name || null,
    id_number: perms.id_number || null,
    phone: perms.phone || null,
    created_by: createdBy || actorId || null,
    created_by_email: createdByEmail || actorEmail || null,
    updated_by: actorId || null,
    updated_by_email: actorEmail || null,
  };

  const { error } = await supabaseAdmin.from('system_admin_permissions').upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
  return perms;
}

async function getSystemAdminPermsForUsers(userIds = []) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('system_admin_permissions')
    .select('user_id, can_finance_act, can_registry, can_monitor, can_alerts, is_active, created_at, updated_at, created_by, created_by_email, updated_by, updated_by_email, full_name, id_number, phone')
    .in('user_id', userIds);
  if (error) throw error;
  return data || [];
}

async function getSystemAdminPerms(userId, role) {
  const normalizedRole = normalizeSystemAdminRole(role);
  const defaultPerms = normalizeSystemAdminPerms({}, normalizedRole);
  if (!userId) return defaultPerms;
  if (normalizedRole === 'SUPER_ADMIN') return defaultPerms;
  const { data, error } = await supabaseAdmin
    .from('system_admin_permissions')
    .select('can_finance_act, can_registry, can_monitor, can_alerts, is_active')
    .eq('user_id', userId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return defaultPerms;
  return normalizeSystemAdminPerms(data, normalizedRole);
}

function normalizeOperatorType(value){
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'MATATU_SACCO' || raw === 'MATATU_COMPANY' || raw === 'BODA_GROUP' || raw === 'TAXI_FLEET') {
    return raw;
  }
  if (raw === 'SACCO' || raw === 'MATATU') return 'MATATU_SACCO';
  if (raw === 'BODA' || raw === 'BODABODA') return 'BODA_GROUP';
  if (raw === 'TAXI') return 'TAXI_FLEET';
  return 'MATATU_SACCO';
}

function defaultFeeLabelForType(operatorType){
  if (operatorType === 'BODA_GROUP') return 'Stage Fee';
  if (operatorType === 'TAXI_FLEET') return 'Dispatch Fee';
  return 'Daily Fee';
}

function parseBooleanFlag(value, fallback){
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'yes') return true;
    if (raw === 'false' || raw === '0' || raw === 'no') return false;
  }
  return fallback;
}

function generateTempPassword(){
  return `OP${crypto.randomBytes(6).toString('hex')}`;
}

async function ensureMatatuForVehicle({ plate, vehicleType, saccoId = null, ownerName = null, ownerPhone = null }) {
  const numberPlate = String(plate || '').trim().toUpperCase();
  if (!numberPlate) throw new Error('vehicle identifier required');
  const normalizedType = String(vehicleType || '').trim().toUpperCase();
  if (!normalizedType) throw new Error('vehicle_type required');

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('matatus')
    .select('id, vehicle_type')
    .eq('number_plate', numberPlate)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    const existingType = String(existing.vehicle_type || '').trim().toUpperCase();
    const compatible =
      (existingType === 'MATATU' && normalizedType === 'SHUTTLE') ||
      (existingType === 'SHUTTLE' && normalizedType === 'MATATU');
    if (existingType && existingType !== normalizedType && !compatible) {
      throw new Error('Vehicle plate already registered as ' + existingType);
    }
    return existing.id;
  }

  const row = {
    sacco_id: saccoId || null,
    number_plate: numberPlate,
    owner_name: ownerName || null,
    owner_phone: ownerPhone || null,
    vehicle_type: normalizedType,
    tlb_number: null,
    till_number: null,
  };
  const { data, error } = await supabaseAdmin.from('matatus').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

async function resolveMatatuIdFromVehicle({ matatuId, vehicleId, vehicleType }) {
  if (matatuId) return matatuId;
  if (!vehicleId || !vehicleType) return null;
  const normalizedType = String(vehicleType || '').trim().toUpperCase();
  if (!normalizedType) return null;

  if (normalizedType === 'MATATU') return vehicleId;
  if (normalizedType === 'SHUTTLE') {
    const { data: shuttle, error } = await supabaseAdmin
      .from('shuttles')
      .select('id, plate, operator_id, owner_id')
      .eq('id', vehicleId)
      .maybeSingle();
    if (error) throw error;
    if (!shuttle) throw new Error('Shuttle not found');

    let ownerName = null;
    let ownerPhone = null;
    if (shuttle.owner_id) {
      const { data: owner, error: ownerErr } = await supabaseAdmin
        .from('shuttle_owners')
        .select('full_name, phone')
        .eq('id', shuttle.owner_id)
        .maybeSingle();
      if (ownerErr) throw ownerErr;
      ownerName = owner?.full_name || null;
      ownerPhone = owner?.phone || null;
    }

    return await ensureMatatuForVehicle({
      plate: shuttle.plate,
      vehicleType: 'SHUTTLE',
      saccoId: shuttle.operator_id || null,
      ownerName,
      ownerPhone,
    });
  }
  if (normalizedType === 'TAXI') {
    const { data: taxi, error } = await supabaseAdmin
      .from('taxis')
      .select('id, plate, operator_id, owner_id')
      .eq('id', vehicleId)
      .maybeSingle();
    if (error) throw error;
    if (!taxi) throw new Error('Taxi not found');

    let ownerName = null;
    let ownerPhone = null;
    if (taxi.owner_id) {
      const { data: owner, error: ownerErr } = await supabaseAdmin
        .from('taxi_owners')
        .select('full_name, phone')
        .eq('id', taxi.owner_id)
        .maybeSingle();
      if (ownerErr) throw ownerErr;
      ownerName = owner?.full_name || null;
      ownerPhone = owner?.phone || null;
    }

    return await ensureMatatuForVehicle({
      plate: taxi.plate,
      vehicleType: 'TAXI',
      saccoId: taxi.operator_id || null,
      ownerName,
      ownerPhone,
    });
  }
  if (normalizedType === 'BODA' || normalizedType === 'BODABODA') {
    const { data: bike, error } = await supabaseAdmin
      .from('boda_bikes')
      .select('id, identifier, operator_id, rider_id')
      .eq('id', vehicleId)
      .maybeSingle();
    if (error) throw error;
    if (!bike) throw new Error('Boda bike not found');

    let riderName = null;
    let riderPhone = null;
    if (bike.rider_id) {
      const { data: rider, error: riderErr } = await supabaseAdmin
        .from('boda_riders')
        .select('full_name, phone')
        .eq('id', bike.rider_id)
        .maybeSingle();
      if (riderErr) throw riderErr;
      riderName = rider?.full_name || null;
      riderPhone = rider?.phone || null;
    }

    return await ensureMatatuForVehicle({
      plate: bike.identifier,
      vehicleType: 'BODABODA',
      saccoId: bike.operator_id || null,
      ownerName: riderName,
      ownerPhone: riderPhone,
    });
  }

  return null;
}

async function upsertUserRole({ user_id, role, sacco_id = null, matatu_id = null }){
  const normalizeRole = (r) => {
    const upper = String(r || '').trim().toUpperCase();
    if (upper === 'DRIVER' || upper === 'MATATU_STAFF') return 'STAFF';
    if (upper === 'OPERATOR_ADMIN') return 'SACCO'; // TODO: adopt OPERATOR_ADMIN when backend roles expand.
    return upper;
  };
  role = normalizeRole(role);
  const { error } = await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id, role, sacco_id, matatu_id }, { onConflict: 'user_id' });
  if (error) throw error;
}

router.post('/register-sacco', async (req,res)=>{
  const displayName = String(req.body?.display_name || req.body?.name || '').trim();
  const operatorType = normalizeOperatorType(req.body?.operator_type || req.body?.org_type || req.body?.operatorType || req.body?.type);
  const feeLabelDefault = defaultFeeLabelForType(operatorType);
  const routesDefault = operatorType === 'MATATU_SACCO' || operatorType === 'MATATU_COMPANY';
  const statusRaw = String(req.body?.status || 'ACTIVE').trim().toUpperCase();
  const adminName = String(req.body?.admin_name || req.body?.dashboard_manager_name || '').trim();
  const row = {
    name: displayName || null,
    display_name: displayName || null,
    operator_type: operatorType,
    org_type: operatorType,
    legal_name: String(req.body?.legal_name || '').trim() || null,
    registration_no: String(req.body?.registration_no || '').trim() || null,
    status: statusRaw === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
    contact_name: String(req.body?.contact_name || '').trim() || null,
    contact_phone: String(req.body?.contact_phone || '').trim() || null,
    contact_email: String(req.body?.contact_email || '').trim() || null,
    default_till: String(req.body?.default_till || '').trim() || null,
    settlement_bank_name: String(req.body?.settlement_bank_name || '').trim() || null,
    settlement_bank_account_number: String(req.body?.settlement_bank_account_number || '').trim() || null,
    fee_label: String(req.body?.fee_label || '').trim() || feeLabelDefault,
    savings_enabled: parseBooleanFlag(req.body?.savings_enabled, true),
    loans_enabled: parseBooleanFlag(req.body?.loans_enabled, true),
    routes_enabled: parseBooleanFlag(req.body?.routes_enabled, routesDefault),
  };
  if (!row.name) return res.status(400).json({ error:'display_name required' });

  const loginEmail = String(req.body?.admin_email || req.body?.login_email || '').trim();
  const loginPhone = String(req.body?.admin_phone || '').trim();
  let loginPassword = req.body?.admin_password || req.body?.login_password || '';
  if (!loginEmail && loginPassword) {
    return res.status(400).json({ error:'login_email required when password is provided' });
  }
  let generatedPassword = '';
  if (loginEmail && !loginPassword) {
    generatedPassword = generateTempPassword();
    loginPassword = generatedPassword;
  }

  const { data, error } = await supabaseAdmin.from('saccos').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const result = { ...data };
  if (loginEmail && loginPassword){
    try{
      const { userId, created } = await ensureAuthUser(loginEmail, loginPassword);
      await upsertUserRole({ user_id: userId, role: 'SACCO', sacco_id: data.id });
      result.created_user = { email: loginEmail, role: 'SACCO' };
      if (created && generatedPassword) {
        result.created_user.temp_password = generatedPassword;
      }
      if (!created) {
        result.created_user.note = 'User existed; password not reset';
      }
      try {
        const staffName = adminName || (displayName ? `${displayName} Admin` : 'Operator Admin');
        const { data: existingStaff, error: staffLookupErr } = await supabaseAdmin
          .from('staff_profiles')
          .select('id')
          .eq('user_id', userId)
          .eq('sacco_id', data.id)
          .limit(1);
        if (staffLookupErr) throw staffLookupErr;
        const staffPayload = {
          user_id: userId,
          sacco_id: data.id,
          role: 'SACCO_ADMIN',
          name: staffName || null,
          phone: loginPhone || null,
          email: loginEmail || null,
        };
        if (existingStaff && existingStaff.length) {
          const { error: staffErr } = await supabaseAdmin
            .from('staff_profiles')
            .update(staffPayload)
            .eq('id', existingStaff[0].id);
          if (staffErr) {
            result.staff_profile_error = staffErr.message;
          }
        } else {
          const { error: staffErr } = await supabaseAdmin.from('staff_profiles').insert(staffPayload);
          if (staffErr) {
            result.staff_profile_error = staffErr.message;
          }
        }
      } catch (staffErr) {
        result.staff_profile_error = staffErr?.message || 'Failed to save admin profile';
      }
    }catch(e){
      result.login_error = e.message || 'Failed to create operator login';
    }
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const baseRef = deriveNumericRef(result.default_till, result.id);
      const feeWallet = await createWalletRecord({
        entityType: 'SACCO',
        entityId: result.id,
        walletType: 'sacco',
        walletKind: 'SACCO_DAILY_FEE',
        saccoId: result.id,
        numericRef: baseRef,
        client,
      });
      const loanWallet = await createWalletRecord({
        entityType: 'SACCO',
        entityId: result.id,
        walletType: 'sacco',
        walletKind: 'SACCO_LOAN',
        saccoId: result.id,
        numericRef: baseRef + 10000,
        client,
      });
      const savingsWallet = await createWalletRecord({
        entityType: 'SACCO',
        entityId: result.id,
        walletType: 'sacco',
        walletKind: 'SACCO_SAVINGS',
        saccoId: result.id,
        numericRef: baseRef + 20000,
        client,
      });

      const feeCode = await ensurePaybillAlias({
        walletId: feeWallet.id,
        key: PAYBILL_KEY_BY_KIND.SACCO_DAILY_FEE,
        client,
      });
      const loanCode = await ensurePaybillAlias({
        walletId: loanWallet.id,
        key: PAYBILL_KEY_BY_KIND.SACCO_LOAN,
        client,
      });
      const savingsCode = await ensurePaybillAlias({
        walletId: savingsWallet.id,
        key: PAYBILL_KEY_BY_KIND.SACCO_SAVINGS,
        client,
      });

      await client.query(`UPDATE saccos SET wallet_id = $1 WHERE id = $2`, [feeWallet.id, result.id]);
      await client.query('COMMIT');

      result.wallet_id = feeWallet.id;
      result.wallet_ids = {
        daily_fee: feeWallet.id,
        loan: loanWallet.id,
        savings: savingsWallet.id,
      };
      result.paybill_codes = {
        daily_fee: feeCode,
        loan: loanCode,
        savings: savingsCode,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return res.status(500).json({ error: 'SACCO created but wallet failed: ' + e.message });
  }
  await logAdminAction({
    req,
    action: 'sacco_register',
    resource_type: 'sacco',
    resource_id: result.id,
    payload: { name: result.name, operator_type: result.operator_type, created_user: result.created_user || null },
  });
  res.json(result);
});
router.post('/update-sacco', async (req,res)=>{
  const { id, ...rest } = req.body||{};
  if(!id) return res.status(400).json({error:'id required'});
  if (rest.operator_type) {
    rest.operator_type = normalizeOperatorType(rest.operator_type);
    if (!rest.org_type) rest.org_type = rest.operator_type;
  }
  if (rest.status) {
    const nextStatus = String(rest.status).trim().toUpperCase();
    rest.status = nextStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
  }
  const { data, error } = await supabaseAdmin.from('saccos').update(rest).eq('id',id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'sacco_update',
    resource_type: 'sacco',
    resource_id: id,
    payload: rest,
  });
  res.json(data);
});
router.delete('/delete-sacco/:id', requireSuperOnly, async (req,res)=>{
  const { error } = await supabaseAdmin.from('saccos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'sacco_delete',
    resource_type: 'sacco',
    resource_id: req.params.id,
    payload: {},
  });
  res.json({ deleted: 1 });
});

// Matatus
router.get('/matatus', async (req,res)=>{
  let q = supabaseAdmin.from('matatus').select('*').order('created_at',{ascending:false});
  if (req.query.sacco_id) q = q.eq('sacco_id', req.query.sacco_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/register-matatu', async (req,res)=>{
  const vehicleType = (req.body?.vehicle_type || 'MATATU').toString().toUpperCase();
  const saccoRaw = req.body?.sacco_id;
  const saccoId = typeof saccoRaw === 'string' ? saccoRaw.trim() : saccoRaw;
  const row = {
    sacco_id: saccoId || null,
    number_plate: (req.body?.number_plate||'').toUpperCase(),
    owner_name: req.body?.owner_name,
    owner_phone: req.body?.owner_phone,
    vehicle_type: vehicleType,
    tlb_number: req.body?.tlb_number,
    till_number: req.body?.till_number
  };
  if(!row.number_plate) return res.status(400).json({error:'number_plate required'});
  const needsSacco = vehicleType !== 'TAXI' && vehicleType !== 'BODABODA';
  if (needsSacco && !row.sacco_id) return res.status(400).json({error:`sacco_id required for ${vehicleType}`});
  const { data, error } = await supabaseAdmin.from('matatus').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const baseRef = deriveNumericRef(data.number_plate, data.tlb_number, data.id);
      const normalizedType = vehicleType === 'BODA' ? 'BODABODA' : vehicleType;
      let primaryWallet = null;
      let walletIds = null;
      let paybillCodes = null;
      let plateAlias = null;

      if (normalizedType === 'MATATU') {
        const ownerWallet = await createWalletRecord({
          entityType: 'MATATU',
          entityId: data.id,
          walletType: 'owner',
          walletKind: 'MATATU_OWNER',
          saccoId: data.sacco_id || null,
          matatuId: data.id,
          numericRef: baseRef + 10000,
          client,
        });
        const vehicleWallet = await createWalletRecord({
          entityType: 'MATATU',
          entityId: data.id,
          walletType: 'matatu',
          walletKind: 'MATATU_VEHICLE',
          saccoId: data.sacco_id || null,
          matatuId: data.id,
          numericRef: baseRef,
          client,
        });

        const ownerCode = await ensurePaybillAlias({
          walletId: ownerWallet.id,
          key: PAYBILL_KEY_BY_KIND.MATATU_OWNER,
          client,
        });
        const vehicleCode = await ensurePaybillAlias({
          walletId: vehicleWallet.id,
          key: PAYBILL_KEY_BY_KIND.MATATU_VEHICLE,
          client,
        });

        const normalizedPlate = normalizeRef(data.number_plate || '');
        if (normalizedPlate && isPlateRef(normalizedPlate)) {
          plateAlias = await ensurePlateAlias({
            walletId: vehicleWallet.id,
            plate: normalizedPlate,
            client,
          });
        }

        primaryWallet = vehicleWallet;
        walletIds = { owner: ownerWallet.id, vehicle: vehicleWallet.id };
        paybillCodes = { owner: ownerCode, vehicle: vehicleCode };
      } else if (normalizedType === 'TAXI') {
        const taxiWallet = await createWalletRecord({
          entityType: 'TAXI',
          entityId: data.id,
          walletType: 'matatu',
          walletKind: 'TAXI_DRIVER',
          saccoId: data.sacco_id || null,
          matatuId: data.id,
          numericRef: baseRef,
          client,
        });
        const taxiCode = await ensurePaybillAlias({
          walletId: taxiWallet.id,
          key: PAYBILL_KEY_BY_KIND.TAXI_DRIVER,
          client,
        });
        primaryWallet = taxiWallet;
        walletIds = { driver: taxiWallet.id };
        paybillCodes = { driver: taxiCode };
      } else if (normalizedType === 'BODABODA') {
        const bodaWallet = await createWalletRecord({
          entityType: 'BODABODA',
          entityId: data.id,
          walletType: 'matatu',
          walletKind: 'BODA_RIDER',
          saccoId: data.sacco_id || null,
          matatuId: data.id,
          numericRef: baseRef,
          client,
        });
        const bodaCode = await ensurePaybillAlias({
          walletId: bodaWallet.id,
          key: PAYBILL_KEY_BY_KIND.BODA_RIDER,
          client,
        });
        primaryWallet = bodaWallet;
        walletIds = { rider: bodaWallet.id };
        paybillCodes = { rider: bodaCode };
      } else {
        const vehicleWallet = await createWalletRecord({
          entityType: 'MATATU',
          entityId: data.id,
          walletType: 'matatu',
          walletKind: 'MATATU_VEHICLE',
          saccoId: data.sacco_id || null,
          matatuId: data.id,
          numericRef: baseRef,
          client,
        });
        const vehicleCode = await ensurePaybillAlias({
          walletId: vehicleWallet.id,
          key: PAYBILL_KEY_BY_KIND.MATATU_VEHICLE,
          client,
        });
        primaryWallet = vehicleWallet;
        walletIds = { vehicle: vehicleWallet.id };
        paybillCodes = { vehicle: vehicleCode };
      }

      if (primaryWallet?.id) {
        await client.query(`UPDATE matatus SET wallet_id = $1 WHERE id = $2`, [primaryWallet.id, data.id]);
      }
      await client.query('COMMIT');

      await logAdminAction({
        req,
        action: 'matatu_register',
        resource_type: normalizedType === 'BODABODA' ? 'boda' : 'matatu',
        resource_id: data.id,
        payload: { sacco_id: data.sacco_id || null, vehicle_type: normalizedType, number_plate: data.number_plate },
      });

      res.json({
        ...data,
        wallet_id: primaryWallet?.id || null,
        virtual_account_code: primaryWallet?.virtual_account_code || null,
        wallet_ids: walletIds,
        paybill_codes: paybillCodes,
        plate_alias: plateAlias,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: 'Matatu created but wallet failed: ' + e.message });
  }
});
router.post('/update-matatu', async (req,res)=>{
  const { id, ...rest } = req.body||{};
  if(!id) return res.status(400).json({error:'id required'});
  if (rest.number_plate) rest.number_plate = String(rest.number_plate).toUpperCase();
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('matatus')
    .select('number_plate, wallet_id')
    .eq('id', id)
    .maybeSingle();
  if (existingErr) return res.status(500).json({ error: existingErr.message });
  if (!existing) return res.status(404).json({ error: 'matatu not found' });

  const { data, error } = await supabaseAdmin.from('matatus').update(rest).eq('id',id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const nextPlate = data?.number_plate || null;
  if (rest.number_plate && nextPlate && existing.wallet_id && nextPlate !== existing.number_plate) {
    try {
      await ensurePlateAlias({ walletId: existing.wallet_id, plate: nextPlate });
    } catch (aliasErr) {
      console.warn('Failed to update plate alias:', aliasErr.message);
    }
  }

  await logAdminAction({
    req,
    action: 'matatu_update',
    resource_type: 'matatu',
    resource_id: id,
    payload: rest,
  });

  res.json(data);
});
router.delete('/delete-matatu/:id', requireSuperOnly, async (req,res)=>{
  const { error } = await supabaseAdmin.from('matatus').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'matatu_delete',
    resource_type: 'matatu',
    resource_id: req.params.id,
    payload: {},
  });
  res.json({ deleted: 1 });
});

// Shuttles
router.get('/shuttles', async (req,res)=>{
  // TODO: Switch operator join to an operators table if/when it replaces saccos.
  let q = supabaseAdmin
    .from('shuttles')
    .select('*, owner:owner_id(*), operator:operator_id(id, display_name, name)')
    .order('created_at',{ascending:false});
  if (req.query.operator_id) q = q.eq('operator_id', req.query.operator_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/register-shuttle', async (req,res)=>{
  const owner = req.body?.owner || {};
  const shuttle = req.body?.shuttle || {};
  const ownerRow = {
    full_name: String(owner.full_name || '').trim(),
    id_number: String(owner.id_number || '').trim(),
    kra_pin: owner.kra_pin ? String(owner.kra_pin).trim() : null,
    phone: owner.phone ? String(owner.phone).trim() : '',
    email: owner.email ? String(owner.email).trim() : null,
    address: owner.address ? String(owner.address).trim() : null,
    occupation: owner.occupation ? String(owner.occupation).trim() : null,
    location: owner.location ? String(owner.location).trim() : null,
    date_of_birth: owner.date_of_birth || null,
  };
  if (!ownerRow.full_name) return res.status(400).json({ error: 'owner full_name required' });
  if (!ownerRow.id_number) return res.status(400).json({ error: 'owner id_number required' });
  if (!ownerRow.phone) return res.status(400).json({ error: 'owner phone required' });

  const plate = String(shuttle.plate || '').trim().toUpperCase();
  const operatorId = shuttle.operator_id || null;
  const tillNumber = String(shuttle.till_number || '').trim();
  const vehicleType = String(shuttle.vehicle_type || '').trim().toUpperCase();
  const vehicleTypeOther = vehicleType === 'OTHER' ? String(shuttle.vehicle_type_other || '').trim() : '';
  if (!plate) return res.status(400).json({ error: 'plate required' });
  if (!operatorId) return res.status(400).json({ error: 'operator_id required' });
  if (!vehicleType) return res.status(400).json({ error: 'vehicle_type required' });

  const parsePositiveInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const intVal = Math.trunc(num);
    if (intVal <= 0) return null;
    return intVal;
  };
  const seatCapacityRaw = shuttle.seat_capacity;
  const loadCapacityRaw = shuttle.load_capacity_kg;
  const seatCapacity = parsePositiveInt(seatCapacityRaw);
  const loadCapacity = parsePositiveInt(loadCapacityRaw);
  const needsSeatCapacity = ['VAN','MINIBUS','BUS'].includes(vehicleType);
  const needsLoadCapacity = ['PICKUP','LORRY'].includes(vehicleType);
  const seatCapacityProvided = seatCapacityRaw !== null && seatCapacityRaw !== undefined && String(seatCapacityRaw).trim() !== '';
  const loadCapacityProvided = loadCapacityRaw !== null && loadCapacityRaw !== undefined && String(loadCapacityRaw).trim() !== '';

  if (needsSeatCapacity && !seatCapacity) return res.status(400).json({ error: 'seat_capacity required' });
  if (needsLoadCapacity && !loadCapacity) return res.status(400).json({ error: 'load_capacity_kg required' });
  if (!needsSeatCapacity && seatCapacityProvided && !seatCapacity) {
    return res.status(400).json({ error: 'seat_capacity must be positive integer' });
  }
  if (!needsLoadCapacity && loadCapacityProvided && !loadCapacity) {
    return res.status(400).json({ error: 'load_capacity_kg must be positive integer' });
  }

  const rawYear = shuttle.year ? Number(shuttle.year) : null;
  const year = Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;
  const { data: ownerData, error: ownerError } = await supabaseAdmin
    .from('shuttle_owners')
    .insert(ownerRow)
    .select()
    .single();
  if (ownerError) return res.status(500).json({ error: ownerError.message });

  const shuttleRow = {
    plate,
    make: shuttle.make ? String(shuttle.make).trim() : null,
    model: shuttle.model ? String(shuttle.model).trim() : null,
    year,
    operator_id: operatorId,
    vehicle_type: vehicleType,
    vehicle_type_other: vehicleType === 'OTHER' && vehicleTypeOther ? vehicleTypeOther : null,
    seat_capacity: needsSeatCapacity || vehicleType === 'OTHER' ? seatCapacity : null,
    load_capacity_kg: needsLoadCapacity || vehicleType === 'OTHER' ? loadCapacity : null,
    till_number: tillNumber || null,
    owner_id: ownerData.id,
  };
  const { data, error } = await supabaseAdmin.from('shuttles').insert(shuttleRow).select().single();
  if (error) return res.status(500).json({ error: error.message });

  let paybillCodes = null;
  let plateAlias = null;
  try {
    const matatuId = await ensureMatatuForVehicle({
      plate,
      vehicleType: 'SHUTTLE',
      saccoId: operatorId || null,
      ownerName: ownerData.full_name || null,
      ownerPhone: ownerData.phone || null,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: walletRows } = await client.query(
        `
          SELECT id, wallet_kind
          FROM wallets
          WHERE entity_type = 'MATATU'
            AND entity_id = $1
        `,
        [matatuId]
      );

      let ownerWallet = walletRows.find((row) => row.wallet_kind === 'MATATU_OWNER') || null;
      let vehicleWallet = walletRows.find((row) => row.wallet_kind === 'MATATU_VEHICLE') || null;
      const baseRef = deriveNumericRef(plate, matatuId);

      if (!ownerWallet) {
        ownerWallet = await createWalletRecord({
          entityType: 'MATATU',
          entityId: matatuId,
          walletType: 'owner',
          walletKind: 'MATATU_OWNER',
          saccoId: operatorId || null,
          matatuId,
          numericRef: baseRef + 10000,
          client,
        });
      }
      if (!vehicleWallet) {
        vehicleWallet = await createWalletRecord({
          entityType: 'MATATU',
          entityId: matatuId,
          walletType: 'matatu',
          walletKind: 'MATATU_VEHICLE',
          saccoId: operatorId || null,
          matatuId,
          numericRef: baseRef,
          client,
        });
      }

      const ownerCode = await ensurePaybillAlias({
        walletId: ownerWallet.id,
        key: PAYBILL_KEY_BY_KIND.MATATU_OWNER,
        client,
      });
      const vehicleCode = await ensurePaybillAlias({
        walletId: vehicleWallet.id,
        key: PAYBILL_KEY_BY_KIND.MATATU_VEHICLE,
        client,
      });

      const normalizedPlate = normalizeRef(plate);
      if (normalizedPlate && isPlateRef(normalizedPlate)) {
        plateAlias = await ensurePlateAlias({
          walletId: vehicleWallet.id,
          plate: normalizedPlate,
          client,
        });
      }

      await client.query(`UPDATE matatus SET wallet_id = $1 WHERE id = $2`, [vehicleWallet.id, matatuId]);
      await client.query('COMMIT');
      paybillCodes = { owner: ownerCode, vehicle: vehicleCode };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return res.status(500).json({ error: 'Shuttle created but wallet failed: ' + e.message });
  }

  await logAdminAction({
    req,
    action: 'shuttle_register',
    resource_type: 'shuttle',
    resource_id: data.id,
    payload: { operator_id: operatorId, plate, vehicle_type: vehicleType },
  });

  res.json({ ...data, owner: ownerData, paybill_codes: paybillCodes, plate_alias: plateAlias });
});
router.post('/update-shuttle', async (req,res)=>{
  const { id, owner_id, owner, shuttle } = req.body||{};
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!owner_id) return res.status(400).json({ error: 'owner_id required' });

  const ownerPayload = owner || {};
  const ownerUpdate = {
    full_name: String(ownerPayload.full_name || '').trim(),
    id_number: String(ownerPayload.id_number || '').trim(),
    kra_pin: ownerPayload.kra_pin ? String(ownerPayload.kra_pin).trim() : null,
    phone: ownerPayload.phone ? String(ownerPayload.phone).trim() : '',
    email: ownerPayload.email ? String(ownerPayload.email).trim() : null,
    address: ownerPayload.address ? String(ownerPayload.address).trim() : null,
    occupation: ownerPayload.occupation ? String(ownerPayload.occupation).trim() : null,
    location: ownerPayload.location ? String(ownerPayload.location).trim() : null,
    date_of_birth: ownerPayload.date_of_birth || null,
  };
  if (!ownerUpdate.full_name) return res.status(400).json({ error: 'owner full_name required' });
  if (!ownerUpdate.id_number) return res.status(400).json({ error: 'owner id_number required' });
  if (!ownerUpdate.phone) return res.status(400).json({ error: 'owner phone required' });

  const shuttlePayload = shuttle || {};
  const plate = String(shuttlePayload.plate || '').trim().toUpperCase();
  const operatorId = shuttlePayload.operator_id || null;
  const tillNumber = String(shuttlePayload.till_number || '').trim();
  const vehicleType = String(shuttlePayload.vehicle_type || '').trim().toUpperCase();
  const vehicleTypeOther = vehicleType === 'OTHER' ? String(shuttlePayload.vehicle_type_other || '').trim() : '';
  if (!plate) return res.status(400).json({ error: 'plate required' });
  if (!operatorId) return res.status(400).json({ error: 'operator_id required' });
  if (!vehicleType) return res.status(400).json({ error: 'vehicle_type required' });

  const parsePositiveInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const intVal = Math.trunc(num);
    if (intVal <= 0) return null;
    return intVal;
  };
  const seatCapacityRaw = shuttlePayload.seat_capacity;
  const loadCapacityRaw = shuttlePayload.load_capacity_kg;
  const seatCapacity = parsePositiveInt(seatCapacityRaw);
  const loadCapacity = parsePositiveInt(loadCapacityRaw);
  const needsSeatCapacity = ['VAN','MINIBUS','BUS'].includes(vehicleType);
  const needsLoadCapacity = ['PICKUP','LORRY'].includes(vehicleType);
  const seatCapacityProvided = seatCapacityRaw !== null && seatCapacityRaw !== undefined && String(seatCapacityRaw).trim() !== '';
  const loadCapacityProvided = loadCapacityRaw !== null && loadCapacityRaw !== undefined && String(loadCapacityRaw).trim() !== '';

  if (needsSeatCapacity && !seatCapacity) return res.status(400).json({ error: 'seat_capacity required' });
  if (needsLoadCapacity && !loadCapacity) return res.status(400).json({ error: 'load_capacity_kg required' });
  if (!needsSeatCapacity && seatCapacityProvided && !seatCapacity) {
    return res.status(400).json({ error: 'seat_capacity must be positive integer' });
  }
  if (!needsLoadCapacity && loadCapacityProvided && !loadCapacity) {
    return res.status(400).json({ error: 'load_capacity_kg must be positive integer' });
  }

  const rawYear = shuttlePayload.year ? Number(shuttlePayload.year) : null;
  const year = Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;
  const { error: ownerError } = await supabaseAdmin
    .from('shuttle_owners')
    .update(ownerUpdate)
    .eq('id', owner_id);
  if (ownerError) return res.status(500).json({ error: ownerError.message });

  const shuttleUpdate = {
    plate,
    make: shuttlePayload.make ? String(shuttlePayload.make).trim() : null,
    model: shuttlePayload.model ? String(shuttlePayload.model).trim() : null,
    year,
    operator_id: operatorId,
    vehicle_type: vehicleType,
    vehicle_type_other: vehicleType === 'OTHER' && vehicleTypeOther ? vehicleTypeOther : null,
    seat_capacity: needsSeatCapacity || vehicleType === 'OTHER' ? seatCapacity : null,
    load_capacity_kg: needsLoadCapacity || vehicleType === 'OTHER' ? loadCapacity : null,
    till_number: tillNumber || null,
  };
  const { error: shuttleError } = await supabaseAdmin.from('shuttles').update(shuttleUpdate).eq('id', id);
  if (shuttleError) return res.status(500).json({ error: shuttleError.message });

  const { data, error } = await supabaseAdmin
    .from('shuttles')
    .select('*, owner:owner_id(*), operator:operator_id(id, display_name, name)')
    .eq('id', id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'shuttle_update',
    resource_type: 'shuttle',
    resource_id: id,
    payload: { operator_id: operatorId, plate, vehicle_type: vehicleType },
  });
  res.json(data);
});
router.delete('/delete-shuttle/:id', requireSuperOnly, async (req,res)=>{
  const { error } = await supabaseAdmin.from('shuttles').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'shuttle_delete',
    resource_type: 'shuttle',
    resource_id: req.params.id,
    payload: {},
  });
  res.json({ deleted: 1 });
});

// Taxis
router.get('/taxis', async (req,res)=>{
  let q = supabaseAdmin
    .from('taxis')
    .select('*, owner:owner_id(*), operator:operator_id(id, display_name, name)')
    .order('created_at',{ascending:false});
  if (req.query.operator_id) q = q.eq('operator_id', req.query.operator_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/register-taxi', async (req,res)=>{
  const owner = req.body?.owner || {};
  const taxi = req.body?.taxi || {};
  const ownerRow = {
    full_name: String(owner.full_name || '').trim(),
    id_number: String(owner.id_number || '').trim(),
    phone: owner.phone ? String(owner.phone).trim() : '',
    email: owner.email ? String(owner.email).trim() : null,
    address: owner.address ? String(owner.address).trim() : null,
    license_no: owner.license_no ? String(owner.license_no).trim() : null,
    date_of_birth: owner.date_of_birth || null,
  };
  if (!ownerRow.full_name) return res.status(400).json({ error: 'owner full_name required' });
  if (!ownerRow.id_number) return res.status(400).json({ error: 'owner id_number required' });
  if (!ownerRow.phone) return res.status(400).json({ error: 'owner phone required' });

  const plate = String(taxi.plate || '').trim().toUpperCase();
  const operatorId = taxi.operator_id || null;
  const category = String(taxi.category || '').trim().toUpperCase();
  const categoryOther = category === 'OTHER' ? String(taxi.category_other || '').trim() : '';
  if (!plate) return res.status(400).json({ error: 'plate required' });
  if (!operatorId) return res.status(400).json({ error: 'operator_id required' });
  if (!category) return res.status(400).json({ error: 'category required' });

  const parsePositiveInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const intVal = Math.trunc(num);
    if (intVal <= 0) return null;
    return intVal;
  };
  const seatCapacityRaw = taxi.seat_capacity;
  const seatCapacityProvided = seatCapacityRaw !== null && seatCapacityRaw !== undefined && String(seatCapacityRaw).trim() !== '';
  const seatCapacity = parsePositiveInt(seatCapacityRaw);
  if (seatCapacityProvided && !seatCapacity) {
    return res.status(400).json({ error: 'seat_capacity must be positive integer' });
  }

  const rawYear = taxi.year ? Number(taxi.year) : null;
  const year = Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;

  const { data: ownerData, error: ownerError } = await supabaseAdmin
    .from('taxi_owners')
    .insert(ownerRow)
    .select()
    .single();
  if (ownerError) return res.status(500).json({ error: ownerError.message });

  const taxiRow = {
    plate,
    make: taxi.make ? String(taxi.make).trim() : null,
    model: taxi.model ? String(taxi.model).trim() : null,
    year,
    operator_id: operatorId,
    till_number: taxi.till_number ? String(taxi.till_number).trim() : null,
    seat_capacity: seatCapacity || null,
    category,
    category_other: category === 'OTHER' && categoryOther ? categoryOther : null,
    owner_id: ownerData.id,
  };
  const { data, error } = await supabaseAdmin.from('taxis').insert(taxiRow).select().single();
  if (error) return res.status(500).json({ error: error.message });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const baseRef = deriveNumericRef(data.plate, data.id);
      const taxiWallet = await createWalletRecord({
        entityType: 'TAXI',
        entityId: data.id,
        walletType: 'matatu',
        walletKind: 'TAXI_DRIVER',
        saccoId: operatorId,
        numericRef: baseRef,
        client,
      });
      const taxiCode = await ensurePaybillAlias({
        walletId: taxiWallet.id,
        key: PAYBILL_KEY_BY_KIND.TAXI_DRIVER,
        client,
      });
      await client.query('COMMIT');
      await logAdminAction({
        req,
        action: 'taxi_register',
        resource_type: 'taxi',
        resource_id: data.id,
        payload: { operator_id: operatorId, plate, category },
      });
      return res.json({
        ...data,
        owner: ownerData,
        wallet_id: taxiWallet.id,
        virtual_account_code: taxiWallet.virtual_account_code,
        paybill_codes: { driver: taxiCode },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return res.status(500).json({ error: 'Taxi created but wallet failed: ' + e.message });
  }
});
router.post('/update-taxi', async (req,res)=>{
  const { id, owner_id, owner, taxi } = req.body||{};
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!owner_id) return res.status(400).json({ error: 'owner_id required' });

  const ownerPayload = owner || {};
  const ownerUpdate = {
    full_name: String(ownerPayload.full_name || '').trim(),
    id_number: String(ownerPayload.id_number || '').trim(),
    phone: ownerPayload.phone ? String(ownerPayload.phone).trim() : '',
    email: ownerPayload.email ? String(ownerPayload.email).trim() : null,
    address: ownerPayload.address ? String(ownerPayload.address).trim() : null,
    license_no: ownerPayload.license_no ? String(ownerPayload.license_no).trim() : null,
    date_of_birth: ownerPayload.date_of_birth || null,
  };
  if (!ownerUpdate.full_name) return res.status(400).json({ error: 'owner full_name required' });
  if (!ownerUpdate.id_number) return res.status(400).json({ error: 'owner id_number required' });
  if (!ownerUpdate.phone) return res.status(400).json({ error: 'owner phone required' });

  const taxiPayload = taxi || {};
  const plate = String(taxiPayload.plate || '').trim().toUpperCase();
  const operatorId = taxiPayload.operator_id || null;
  const category = String(taxiPayload.category || '').trim().toUpperCase();
  const categoryOther = category === 'OTHER' ? String(taxiPayload.category_other || '').trim() : '';
  if (!plate) return res.status(400).json({ error: 'plate required' });
  if (!operatorId) return res.status(400).json({ error: 'operator_id required' });
  if (!category) return res.status(400).json({ error: 'category required' });

  const parsePositiveInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const intVal = Math.trunc(num);
    if (intVal <= 0) return null;
    return intVal;
  };
  const seatCapacityRaw = taxiPayload.seat_capacity;
  const seatCapacityProvided = seatCapacityRaw !== null && seatCapacityRaw !== undefined && String(seatCapacityRaw).trim() !== '';
  const seatCapacity = parsePositiveInt(seatCapacityRaw);
  if (seatCapacityProvided && !seatCapacity) {
    return res.status(400).json({ error: 'seat_capacity must be positive integer' });
  }

  const rawYear = taxiPayload.year ? Number(taxiPayload.year) : null;
  const year = Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;

  const { error: ownerError } = await supabaseAdmin
    .from('taxi_owners')
    .update(ownerUpdate)
    .eq('id', owner_id);
  if (ownerError) return res.status(500).json({ error: ownerError.message });

  const taxiUpdate = {
    plate,
    make: taxiPayload.make ? String(taxiPayload.make).trim() : null,
    model: taxiPayload.model ? String(taxiPayload.model).trim() : null,
    year,
    operator_id: operatorId,
    till_number: taxiPayload.till_number ? String(taxiPayload.till_number).trim() : null,
    seat_capacity: seatCapacity || null,
    category,
    category_other: category === 'OTHER' && categoryOther ? categoryOther : null,
  };
  const { error: taxiError } = await supabaseAdmin.from('taxis').update(taxiUpdate).eq('id', id);
  if (taxiError) return res.status(500).json({ error: taxiError.message });

  const { data, error } = await supabaseAdmin
    .from('taxis')
    .select('*, owner:owner_id(*), operator:operator_id(id, display_name, name)')
    .eq('id', id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'taxi_update',
    resource_type: 'taxi',
    resource_id: id,
    payload: { operator_id: operatorId, plate, category },
  });
  res.json(data);
});
router.delete('/delete-taxi/:id', requireSuperOnly, async (req,res)=>{
  const { error } = await supabaseAdmin.from('taxis').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'taxi_delete',
    resource_type: 'taxi',
    resource_id: req.params.id,
    payload: {},
  });
  res.json({ deleted: 1 });
});

// Boda Bodas
router.get('/boda-bikes', async (req,res)=>{
  let q = supabaseAdmin
    .from('boda_bikes')
    .select('*, rider:rider_id(*), operator:operator_id(id, display_name, name)')
    .order('created_at',{ascending:false});
  if (req.query.operator_id) q = q.eq('operator_id', req.query.operator_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/register-boda', async (req,res)=>{
  const rider = req.body?.rider || {};
  const bike = req.body?.bike || {};
  const riderRow = {
    full_name: String(rider.full_name || '').trim(),
    id_number: String(rider.id_number || '').trim(),
    phone: rider.phone ? String(rider.phone).trim() : '',
    email: rider.email ? String(rider.email).trim() : null,
    address: rider.address ? String(rider.address).trim() : null,
    stage: rider.stage ? String(rider.stage).trim() : null,
    town: rider.town ? String(rider.town).trim() : null,
    date_of_birth: rider.date_of_birth || null,
  };
  if (!riderRow.full_name) return res.status(400).json({ error: 'rider full_name required' });
  if (!riderRow.id_number) return res.status(400).json({ error: 'rider id_number required' });
  if (!riderRow.phone) return res.status(400).json({ error: 'rider phone required' });

  const identifier = String(bike.identifier || '').trim();
  const operatorId = bike.operator_id || null;
  if (!identifier) return res.status(400).json({ error: 'identifier required' });
  if (!operatorId) return res.status(400).json({ error: 'operator_id required' });

  const rawYear = bike.year ? Number(bike.year) : null;
  const year = Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;

  const { data: riderData, error: riderError } = await supabaseAdmin
    .from('boda_riders')
    .insert(riderRow)
    .select()
    .single();
  if (riderError) return res.status(500).json({ error: riderError.message });

  const bikeRow = {
    identifier,
    make: bike.make ? String(bike.make).trim() : null,
    model: bike.model ? String(bike.model).trim() : null,
    year,
    operator_id: operatorId,
    till_number: bike.till_number ? String(bike.till_number).trim() : null,
    license_no: bike.license_no ? String(bike.license_no).trim() : null,
    has_helmet: Boolean(bike.has_helmet),
    has_reflector: Boolean(bike.has_reflector),
    rider_id: riderData.id,
  };
  const { data, error } = await supabaseAdmin.from('boda_bikes').insert(bikeRow).select().single();
  if (error) return res.status(500).json({ error: error.message });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const baseRef = deriveNumericRef(data.identifier, data.id);
      const bodaWallet = await createWalletRecord({
        entityType: 'BODA',
        entityId: data.id,
        walletType: 'matatu',
        walletKind: 'BODA_RIDER',
        saccoId: operatorId,
        numericRef: baseRef,
        client,
      });
      const bodaCode = await ensurePaybillAlias({
        walletId: bodaWallet.id,
        key: PAYBILL_KEY_BY_KIND.BODA_RIDER,
        client,
      });
      await client.query('COMMIT');
      await logAdminAction({
        req,
        action: 'boda_register',
        resource_type: 'boda_bike',
        resource_id: data.id,
        payload: { operator_id: operatorId, identifier, rider_id: riderData.id },
      });
      return res.json({
        ...data,
        rider: riderData,
        wallet_id: bodaWallet.id,
        virtual_account_code: bodaWallet.virtual_account_code,
        paybill_codes: { rider: bodaCode },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return res.status(500).json({ error: 'Boda created but wallet failed: ' + e.message });
  }
});
router.post('/update-boda', async (req,res)=>{
  const { id, rider_id, rider, bike } = req.body||{};
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!rider_id) return res.status(400).json({ error: 'rider_id required' });

  const riderPayload = rider || {};
  const riderUpdate = {
    full_name: String(riderPayload.full_name || '').trim(),
    id_number: String(riderPayload.id_number || '').trim(),
    phone: riderPayload.phone ? String(riderPayload.phone).trim() : '',
    email: riderPayload.email ? String(riderPayload.email).trim() : null,
    address: riderPayload.address ? String(riderPayload.address).trim() : null,
    stage: riderPayload.stage ? String(riderPayload.stage).trim() : null,
    town: riderPayload.town ? String(riderPayload.town).trim() : null,
    date_of_birth: riderPayload.date_of_birth || null,
  };
  if (!riderUpdate.full_name) return res.status(400).json({ error: 'rider full_name required' });
  if (!riderUpdate.id_number) return res.status(400).json({ error: 'rider id_number required' });
  if (!riderUpdate.phone) return res.status(400).json({ error: 'rider phone required' });

  const bikePayload = bike || {};
  const identifier = String(bikePayload.identifier || '').trim();
  const operatorId = bikePayload.operator_id || null;
  if (!identifier) return res.status(400).json({ error: 'identifier required' });
  if (!operatorId) return res.status(400).json({ error: 'operator_id required' });

  const rawYear = bikePayload.year ? Number(bikePayload.year) : null;
  const year = Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;

  const { error: riderError } = await supabaseAdmin
    .from('boda_riders')
    .update(riderUpdate)
    .eq('id', rider_id);
  if (riderError) return res.status(500).json({ error: riderError.message });

  const bikeUpdate = {
    identifier,
    make: bikePayload.make ? String(bikePayload.make).trim() : null,
    model: bikePayload.model ? String(bikePayload.model).trim() : null,
    year,
    operator_id: operatorId,
    till_number: bikePayload.till_number ? String(bikePayload.till_number).trim() : null,
    license_no: bikePayload.license_no ? String(bikePayload.license_no).trim() : null,
    has_helmet: Boolean(bikePayload.has_helmet),
    has_reflector: Boolean(bikePayload.has_reflector),
  };
  const { error: bikeError } = await supabaseAdmin.from('boda_bikes').update(bikeUpdate).eq('id', id);
  if (bikeError) return res.status(500).json({ error: bikeError.message });

  const { data, error } = await supabaseAdmin
    .from('boda_bikes')
    .select('*, rider:rider_id(*), operator:operator_id(id, display_name, name)')
    .eq('id', id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'boda_update',
    resource_type: 'boda_bike',
    resource_id: id,
    payload: { operator_id: operatorId, identifier },
  });
  res.json(data);
});
router.delete('/delete-boda/:id', requireSuperOnly, async (req,res)=>{
  const { error } = await supabaseAdmin.from('boda_bikes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction({
    req,
    action: 'boda_delete',
    resource_type: 'boda_bike',
    resource_id: req.params.id,
    payload: {},
  });
  res.json({ deleted: 1 });
});

// Shuttle Care - Maintenance Logs
router.get('/maintenance-logs', async (req,res)=>{
  let q = supabaseAdmin
    .from('maintenance_logs')
    .select(
      '*, shuttle:shuttle_id(id, plate, operator_id), operator:operator_id(id, display_name, name), reported_by:reported_by_staff_id(id, name, email), handled_by:handled_by_staff_id(id, name, email)',
    )
    .order('occurred_at',{ascending:false});
  if (req.query.operator_id) q = q.eq('operator_id', req.query.operator_id);
  if (req.query.shuttle_id) q = q.eq('shuttle_id', req.query.shuttle_id);
  if (req.query.status) q = q.eq('status', String(req.query.status).toUpperCase());
  if (req.query.category) q = q.eq('issue_category', String(req.query.category).toUpperCase());
  const { from, to } = normalizeDateBounds(req.query.from, req.query.to);
  if (from) q = q.gte('occurred_at', from.toISOString());
  if (to) q = q.lte('occurred_at', to.toISOString());
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});

router.post('/maintenance-logs', async (req,res)=>{
  const payload = req.body || {};
  const shuttleId = payload.shuttle_id || null;
  let operatorId = payload.operator_id || null;
  if (!shuttleId) return res.status(400).json({ error: 'shuttle_id required' });

  if (!operatorId) {
    const { data: shuttleRow, error: shuttleError } = await supabaseAdmin
      .from('shuttles')
      .select('operator_id')
      .eq('id', shuttleId)
      .maybeSingle();
    if (shuttleError) return res.status(500).json({ error: shuttleError.message });
    operatorId = shuttleRow?.operator_id || null;
  }

  const issueCategory = String(payload.issue_category || '').trim().toUpperCase();
  const issueDescription = String(payload.issue_description || '').trim();
  const status = String(payload.status || 'OPEN').trim().toUpperCase();
  if (!issueCategory) return res.status(400).json({ error: 'issue_category required' });
  if (!issueDescription) return res.status(400).json({ error: 'issue_description required' });
  if (!status) return res.status(400).json({ error: 'status required' });

  const parseNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return num;
  };
  const parseIntVal = (value) => {
    const num = parseNumber(value);
    if (num === null) return null;
    const intVal = Math.trunc(num);
    return intVal < 0 ? null : intVal;
  };
  const normalizeDate = (value) => {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    return trimmed;
  };
  const normalizeParts = (value) => {
    if (!Array.isArray(value)) return null;
    const parts = value
      .map((part) => ({
        name: String(part?.name || '').trim() || 'Unknown',
        qty: parseIntVal(part?.qty),
        cost: parseNumber(part?.cost),
      }))
      .filter((part) => part.name || part.qty !== null || part.cost !== null);
    return parts.length ? parts : null;
  };

  const occurredAt = normalizeDate(payload.occurred_at) || new Date().toISOString();
  let resolvedAt = normalizeDate(payload.resolved_at);
  if (status === 'RESOLVED' && !resolvedAt) resolvedAt = new Date().toISOString();

  const row = {
    shuttle_id: shuttleId,
    operator_id: operatorId,
    reported_by_staff_id: payload.reported_by_staff_id || null,
    handled_by_staff_id: payload.handled_by_staff_id || null,
    issue_category: issueCategory,
    issue_description: issueDescription,
    parts_used: normalizeParts(payload.parts_used),
    total_cost_kes: parseNumber(payload.total_cost_kes),
    downtime_days: parseIntVal(payload.downtime_days),
    status,
    occurred_at: occurredAt,
    resolved_at: resolvedAt,
    next_service_due: normalizeDate(payload.next_service_due),
    notes: payload.notes ? String(payload.notes).trim() : null,
  };

  const { data, error } = await supabaseAdmin
    .from('maintenance_logs')
    .insert(row)
    .select(
      '*, shuttle:shuttle_id(id, plate, operator_id), operator:operator_id(id, display_name, name), reported_by:reported_by_staff_id(id, name, email), handled_by:handled_by_staff_id(id, name, email)',
    )
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/maintenance-logs/update', async (req,res)=>{
  const payload = req.body || {};
  const id = payload.id || null;
  const shuttleId = payload.shuttle_id || null;
  let operatorId = payload.operator_id || null;
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!shuttleId) return res.status(400).json({ error: 'shuttle_id required' });

  if (!operatorId) {
    const { data: shuttleRow, error: shuttleError } = await supabaseAdmin
      .from('shuttles')
      .select('operator_id')
      .eq('id', shuttleId)
      .maybeSingle();
    if (shuttleError) return res.status(500).json({ error: shuttleError.message });
    operatorId = shuttleRow?.operator_id || null;
  }

  const issueCategory = String(payload.issue_category || '').trim().toUpperCase();
  const issueDescription = String(payload.issue_description || '').trim();
  const status = String(payload.status || 'OPEN').trim().toUpperCase();
  if (!issueCategory) return res.status(400).json({ error: 'issue_category required' });
  if (!issueDescription) return res.status(400).json({ error: 'issue_description required' });
  if (!status) return res.status(400).json({ error: 'status required' });

  const parseNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return num;
  };
  const parseIntVal = (value) => {
    const num = parseNumber(value);
    if (num === null) return null;
    const intVal = Math.trunc(num);
    return intVal < 0 ? null : intVal;
  };
  const normalizeDate = (value) => {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    return trimmed;
  };
  const normalizeParts = (value) => {
    if (!Array.isArray(value)) return null;
    const parts = value
      .map((part) => ({
        name: String(part?.name || '').trim() || 'Unknown',
        qty: parseIntVal(part?.qty),
        cost: parseNumber(part?.cost),
      }))
      .filter((part) => part.name || part.qty !== null || part.cost !== null);
    return parts.length ? parts : null;
  };

  const occurredAt = normalizeDate(payload.occurred_at) || new Date().toISOString();
  let resolvedAt = normalizeDate(payload.resolved_at);
  if (status === 'RESOLVED' && !resolvedAt) resolvedAt = new Date().toISOString();

  const row = {
    shuttle_id: shuttleId,
    operator_id: operatorId,
    reported_by_staff_id: payload.reported_by_staff_id || null,
    handled_by_staff_id: payload.handled_by_staff_id || null,
    issue_category: issueCategory,
    issue_description: issueDescription,
    parts_used: normalizeParts(payload.parts_used),
    total_cost_kes: parseNumber(payload.total_cost_kes),
    downtime_days: parseIntVal(payload.downtime_days),
    status,
    occurred_at: occurredAt,
    resolved_at: resolvedAt,
    next_service_due: normalizeDate(payload.next_service_due),
    notes: payload.notes ? String(payload.notes).trim() : null,
  };

  const { data, error } = await supabaseAdmin
    .from('maintenance_logs')
    .update(row)
    .eq('id', id)
    .select(
      '*, shuttle:shuttle_id(id, plate, operator_id), operator:operator_id(id, display_name, name), reported_by:reported_by_staff_id(id, name, email), handled_by:handled_by_staff_id(id, name, email)',
    )
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/user-roles/create-user', async (req,res)=>{
  const email = (req.body?.email || '').trim();
  const password = req.body?.password || '';
  const role = (req.body?.role || '').toUpperCase();
  const saccoId = req.body?.sacco_id || null;
  const matatuId = req.body?.matatu_id || null;
  const vehicleId = req.body?.vehicle_id || null;
  const vehicleType = req.body?.vehicle_type || null;

  if (!email) return res.status(400).json({ error:'email required' });
  if (!password) return res.status(400).json({ error:'password required' });
  if (!role) return res.status(400).json({ error:'role required' });

  const needsSacco = ['SACCO','SACCO_STAFF'].includes(role);
  const needsMatatu = ['OWNER','STAFF','TAXI','BODA'].includes(role);
  if (needsSacco && !saccoId) return res.status(400).json({ error:'sacco_id required for role ' + role });

  try{
    let resolvedMatatuId = matatuId;
    if (needsMatatu) {
      resolvedMatatuId = await resolveMatatuIdFromVehicle({
        matatuId,
        vehicleId,
        vehicleType,
      });
      if (!resolvedMatatuId) {
        return res.status(400).json({ error:'vehicle_id required for role ' + role });
      }
    }
    const { userId } = await ensureAuthUser(email, password);
    await upsertUserRole({ user_id: userId, role, sacco_id: saccoId, matatu_id: resolvedMatatuId });
    await logAdminAction({
      req,
      action: 'user_role_create',
      resource_type: 'user_role',
      resource_id: userId,
      payload: { role, sacco_id: saccoId, matatu_id: resolvedMatatuId },
    });
    res.json({ user_id: userId, role, sacco_id: saccoId, matatu_id: resolvedMatatuId });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to create role user' });
  }
});

router.get('/system-admins/self', async (req,res)=>{
  const userId = req.user?.id || null;
  if (!userId) return res.status(401).json({ error: 'missing user' });
  const role = normalizeSystemAdminRole(req.user?.role || req.adminCtx?.role || 'SYSTEM_ADMIN');
  try{
    const perms = await getSystemAdminPerms(userId, role);
    res.json({ ok: true, user_id: userId, role, permissions: perms });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load permissions' });
  }
});

router.get('/system-admins', async (_req,res)=>{
  try{
    const { data: roleRows, error } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role, created_at')
      .in('role', ['SYSTEM_ADMIN','SUPER_ADMIN'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (!roleRows || roleRows.length === 0) return res.json([]);

    const ids = roleRows.map((r) => r.user_id).filter(Boolean);
    const permRows = await getSystemAdminPermsForUsers(ids);
    const permMap = new Map((permRows || []).map((p) => [p.user_id, p]));

    const enriched = await Promise.all(roleRows.map(async (row) => {
      let email = null;
      if (row.user_id){
        try{
          const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
          if (!userErr) email = userData?.user?.email || null;
        }catch(_){ /* ignore */ }
      }
      const permRow = permMap.get(row.user_id) || null;
      const perms = normalizeSystemAdminPerms(permRow, row.role);
      return {
        ...row,
        email,
        permissions: perms,
        updated_at: permRow?.updated_at || null,
        updated_by: permRow?.updated_by || null,
        updated_by_email: permRow?.updated_by_email || null,
      };
    }));
    res.json(enriched);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load system admins' });
  }
});

router.post('/system-admins', async (req,res)=>{
  const email = (req.body?.email || '').trim();
  const password = req.body?.password || '';
  const role = normalizeSystemAdminRole(req.body?.role || 'SYSTEM_ADMIN');
  const permsBody = req.body?.permissions || {};
  if (req.body?.full_name) permsBody.full_name = req.body.full_name;
  if (req.body?.id_number) permsBody.id_number = req.body.id_number;
  if (req.body?.phone) permsBody.phone = req.body.phone;

  if (!email) return res.status(400).json({ error:'email required' });
  if (!password) return res.status(400).json({ error:'password required' });
  if (!role) return res.status(400).json({ error:'role must be SYSTEM_ADMIN or SUPER_ADMIN' });

  try{
    const { userId } = await ensureAuthUser(email, password);
    await upsertUserRole({ user_id: userId, role, sacco_id: null, matatu_id: null });
    const perms = await upsertSystemAdminPerms(userId, role, permsBody, { id: req.user?.id, email: req.user?.email || null });
    await logAdminAction({
      req,
      action: 'system_admin_create',
      resource_type: 'system_admin',
      resource_id: userId,
      payload: { role, permissions: perms },
    });
    res.json({ user_id: userId, email, role, permissions: perms });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to create system admin' });
  }
});

router.patch('/system-admins/:userId', async (req,res)=>{
  const userId = req.params?.userId;
  if (!userId) return res.status(400).json({ error:'userId required' });
  const nextRole = req.body?.role ? normalizeSystemAdminRole(req.body.role) : null;
  const permsBody = req.body?.permissions || {};
  if (req.body?.full_name !== undefined) permsBody.full_name = req.body.full_name;
  if (req.body?.id_number !== undefined) permsBody.id_number = req.body.id_number;
  if (req.body?.phone !== undefined) permsBody.phone = req.body.phone;
  const password = req.body?.password || null;

  try{
    let role = nextRole;
    if (password) {
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (updErr) throw updErr;
    }
    if (role) {
      await upsertUserRole({ user_id: userId, role, sacco_id: null, matatu_id: null });
    } else {
      const { data: roleRow, error: roleErr } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      if (roleErr && roleErr.code !== 'PGRST116') throw roleErr;
      role = normalizeSystemAdminRole(roleRow?.role || 'SYSTEM_ADMIN');
    }
    const perms = permsBody
      ? await upsertSystemAdminPerms(userId, role, permsBody, { id: req.user?.id, email: req.user?.email || null })
      : await getSystemAdminPerms(userId, role);
    await logAdminAction({
      req,
      action: 'system_admin_update',
      resource_type: 'system_admin',
      resource_id: userId,
      payload: { role, permissions: perms, password_changed: Boolean(password) },
    });
    res.json({ user_id: userId, role, permissions: perms });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to update system admin' });
  }
});

router.get('/user-roles/logins', async (_req,res)=>{
  try{
    const { data, error } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role, sacco_id, matatu_id, created_at')
      .order('created_at', { ascending:false })
      .limit(50);
    if (error) throw error;
    if (!data || !data.length) return res.json([]);

    const enriched = await Promise.all(data.map(async (row) => {
      let email = null;
      if (row.user_id){
        try{
          const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
          if (!userErr) email = userData?.user?.email || null;
        }catch(_){ /* ignore */ }
      }
      return { ...row, email };
    }));

    res.json(enriched);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load logins' });
  }
});

router.post('/user-roles/update', async (req,res)=>{
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const update = {};
  const nextRole = req.body?.role ? String(req.body.role).toUpperCase() : null;
  const saccoId = req.body?.sacco_id ?? null;
  const matatuId = req.body?.matatu_id ?? null;
  const vehicleId = req.body?.vehicle_id ?? null;
  const vehicleType = req.body?.vehicle_type ?? null;

  if (nextRole){
    update.role = nextRole;
  }
  if ('sacco_id' in req.body) update.sacco_id = saccoId;
  if ('matatu_id' in req.body || vehicleId || vehicleType) {
    try {
      update.matatu_id = await resolveMatatuIdFromVehicle({
        matatuId,
        vehicleId,
        vehicleType,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to resolve vehicle' });
    }
  }

  const needsSacco = ['SACCO'].includes(nextRole || '');
  const needsMatatu = ['OWNER','STAFF','TAXI','BODA'].includes(nextRole || '');
  if (needsSacco && !saccoId) return res.status(400).json({ error:'sacco_id required for role ' + nextRole });
  if (needsMatatu && !update.matatu_id) return res.status(400).json({ error:'vehicle_id required for role ' + nextRole });

  try{
    if (Object.keys(update).length){
      const { error } = await supabaseAdmin.from('user_roles').update(update).eq('user_id', userId);
      if (error) throw error;
    }

    const authUpdates = {};
    if (req.body?.email) authUpdates.email = req.body.email;
    if (req.body?.email) authUpdates.email_confirm = true;
    if (req.body?.password) authUpdates.password = req.body.password;
    if (Object.keys(authUpdates).length){
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, authUpdates);
      if (error) throw error;
    }

    await logAdminAction({
      req,
      action: 'user_role_update',
      resource_type: 'user_role',
      resource_id: userId,
      payload: { role: nextRole || null, sacco_id: saccoId, matatu_id: update.matatu_id || matatuId || null },
    });
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to update login' });
  }
});

router.delete('/user-roles/:user_id', requireSuperOnly, async (req,res)=>{
  const userId = req.params.user_id;
  if (!userId) return res.status(400).json({ error:'user_id required' });
  const removeAuth = String(req.query.remove_user || '').toLowerCase() === 'true';
  try{
    const { error } = await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
    if (error) throw error;
    if (removeAuth){
      try{
        await supabaseAdmin.auth.admin.deleteUser(userId);
      }catch(_){ /* ignore */ }
    }
    await logAdminAction({
      req,
      action: 'user_role_delete',
      resource_type: 'user_role',
      resource_id: userId,
      payload: { remove_auth: removeAuth },
    });
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to delete login' });
  }
});

// USSD Pool
function normalizeUssdPrefix(raw){
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '*001*';
  if (trimmed.endsWith('*')) return trimmed;
  return `${trimmed}*`;
}

function digitalRoot(value){
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return 1 + ((Math.floor(num) - 1) % 9);
}

function resolveUssdTierRange(tier){
  const key = String(tier || '').trim().toUpperCase();
  if (key === 'A') return { min: 1, max: 199 };
  if (key === 'B') return { min: 200, max: 699 };
  if (key === 'C') return { min: 700, max: 999 };
  return null;
}

function parseShortUssdEntry(entry, mode){
  const cleaned = String(entry || '').trim().replace(/\s+/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return { error: `invalid code: ${entry}` };

  const asBase = () => {
    const baseNum = Number(digits);
    if (!Number.isFinite(baseNum) || baseNum < 1 || baseNum > 999) {
      return { error: `base out of range: ${entry}` };
    }
    const checksum = digitalRoot(baseNum);
    if (checksum === null) return { error: `invalid base: ${entry}` };
    const base = String(baseNum);
    return { full_code: `${base}${checksum}`, base, checksum };
  };

  const asFull = () => {
    if (digits.length < 2) return { error: `invalid full code: ${entry}` };
    const base = digits.slice(0, -1);
    const check = digits.slice(-1);
    const baseNum = Number(base);
    if (!Number.isFinite(baseNum) || baseNum < 1 || baseNum > 999) {
      return { error: `base out of range: ${entry}` };
    }
    const expected = digitalRoot(baseNum);
    if (expected === null || String(expected) !== check) {
      return { error: `checksum mismatch: ${entry}` };
    }
    return { full_code: digits, base: String(baseNum), checksum: expected };
  };

  if (mode === 'short_base') return asBase();
  if (mode === 'short_full') return asFull();

  if (digits.length >= 2) {
    const base = digits.slice(0, -1);
    const check = digits.slice(-1);
    const expected = digitalRoot(base);
    if (expected !== null && String(expected) === check) {
      return { full_code: digits, base: String(Number(base)), checksum: expected };
    }
  }
  return asBase();
}

function parseUssdEntry(entry, prefix, mode){
  const trimmed = String(entry || '').trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/\s+/g, '');
  const hasSymbols = cleaned.includes('*') || cleaned.includes('#');
  const inputMode = mode || 'legacy';

  if (inputMode !== 'legacy') {
    if (hasSymbols) return { error: `legacy format not allowed: ${trimmed}` };
    return parseShortUssdEntry(cleaned, inputMode);
  }

  if (hasSymbols) {
    const full = cleaned.endsWith('#') ? cleaned : `${cleaned}#`;
    const lastStar = full.lastIndexOf('*');
    if (lastStar === -1) return { error: `invalid ussd code: ${trimmed}` };
    const body = full.slice(lastStar + 1).replace(/#$/, '');
    if (body.length < 2) return { error: `invalid ussd code: ${trimmed}` };
    const base = body.slice(0, -1);
    const checksum = Number(body.slice(-1));
    if (!/^\d+$/.test(base) || Number.isNaN(checksum)) {
      return { error: `invalid ussd code: ${trimmed}` };
    }
    return { full_code: full, base, checksum };
  }

  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return { error: `invalid base: ${trimmed}` };
  const checksum = Number(digits) % 9;
  return {
    full_code: `${prefix}${digits}${checksum}#`,
    base: digits,
    checksum,
  };
}

router.get('/ussd/pool/available', async (_req,res)=>{
  const { data, error } = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE').order('base');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.get('/ussd/pool/allocated', async (_req,res)=>{
  const { data, error } = await supabaseAdmin.from('ussd_pool').select('*').neq('status','AVAILABLE').order('allocated_at',{ascending:false});
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/ussd/pool/assign-next', async (req,res)=>{
  const prefix = req.body?.prefix || '';
  const tierRange = resolveUssdTierRange(req.body?.tier);
  let row = null;

  if (tierRange) {
    const { data, error } = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE');
    if (error) return res.status(500).json({ error: error.message });
    let rows = data || [];
    rows = rows.filter((item) => {
      const baseNum = Number(item.base);
      if (!Number.isFinite(baseNum)) return false;
      return baseNum >= tierRange.min && baseNum <= tierRange.max;
    });
    if (prefix) {
      const norm = String(prefix).toLowerCase();
      rows = rows.filter((item) => String(item.full_code || '').toLowerCase().startsWith(norm));
    }
    if (!rows.length) return res.json({ success:false, error:'no available codes in tier' });
    rows.sort((a, b) => Number(a.base) - Number(b.base));
    row = rows[0];
  } else {
    let query = supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE');
    if (prefix) {
      query = query.ilike('full_code', `${prefix}%`);
    }
    let result = await query.order('base', {ascending:true}).limit(1).maybeSingle();
    row = result.data;
    if (result.error) return res.status(500).json({ error: result.error.message });
    if (!row) {
      const alt = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE').order('base', {ascending:true}).limit(1).maybeSingle();
      row = alt.data;
      if (alt.error) return res.status(500).json({ error: alt.error.message });
      if (!row) return res.json({ success:false, error:'no available codes' });
    }
  }
  const upd = { status:'ALLOCATED', allocated_at: new Date().toISOString(), allocated_to_type: req.body?.level||'MATATU', allocated_to_id: req.body?.matatu_id || req.body?.sacco_id || null };
  const { error: ue } = await supabaseAdmin.from('ussd_pool').update(upd).eq('id', row.id);
  if (ue) return res.status(500).json({ error: ue.message });
  await logAdminAction({
    req,
    action: 'ussd_assign',
    resource_type: 'ussd_code',
    resource_id: row.id,
    payload: { full_code: row.full_code, allocated_to_type: upd.allocated_to_type, allocated_to_id: upd.allocated_to_id },
  });
  res.json({ success:true, ussd_code: row.full_code });
});
router.post('/ussd/bind-from-pool', async (req,res)=>{
  const code = req.body?.ussd_code;
  if (!code) return res.status(400).json({ success:false, error:'ussd_code required' });
  const { data: row, error } = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE').eq('full_code', code).single();
  if (error) return res.status(404).json({ success:false, error:'code not in pool' });
  const upd = { status:'ALLOCATED', allocated_at: new Date().toISOString(), allocated_to_type: req.body?.level||'MATATU', allocated_to_id: req.body?.matatu_id || req.body?.sacco_id || null };
  const { error: ue } = await supabaseAdmin.from('ussd_pool').update(upd).eq('id', row.id);
  if (ue) return res.status(500).json({ success:false, error: ue.message });
  await logAdminAction({
    req,
    action: 'ussd_bind',
    resource_type: 'ussd_code',
    resource_id: row.id,
    payload: { full_code: code, allocated_to_type: upd.allocated_to_type, allocated_to_id: upd.allocated_to_id },
  });
  res.json({ success:true, ussd_code: code });
});

router.post('/ussd/pool/release', async (req,res)=>{
  const id = req.body?.id || null;
  const code = req.body?.ussd_code || null;
  if (!id && !code) return res.status(400).json({ success:false, error:'id or ussd_code required' });
  let q = supabaseAdmin.from('ussd_pool')
    .update({ status:'AVAILABLE', allocated_at: null, allocated_to_type: null, allocated_to_id: null })
    .eq('status','ALLOCATED');
  if (id) q = q.eq('id', id);
  if (code) q = q.eq('full_code', code);
  const { data, error } = await q.select().maybeSingle();
  if (error) return res.status(500).json({ success:false, error: error.message });
  if (!data) return res.status(404).json({ success:false, error:'code not found' });
  await logAdminAction({
    req,
    action: 'ussd_release',
    resource_type: 'ussd_code',
    resource_id: data.id,
    payload: { full_code: data.full_code },
  });
  res.json({ success:true, ussd_code: data.full_code });
});

router.post('/ussd/pool/import', async (req,res)=>{
  const inputModeRaw = String(req.body?.input_mode || 'legacy').trim().toLowerCase();
  const inputMode = ['short_base', 'short_full', 'short_auto', 'legacy'].includes(inputModeRaw)
    ? inputModeRaw
    : 'legacy';
  const prefix = inputMode === 'legacy' ? normalizeUssdPrefix(req.body?.prefix || '*001*') : '';
  const raw = req.body?.raw || '';
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : null;
  const lines = codes && codes.length ? codes : String(raw).split(/\r?\n/);
  const errors = [];
  const parsed = [];

  for (const line of lines) {
    const result = parseUssdEntry(line, prefix, inputMode);
    if (!result) continue;
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    parsed.push(result);
  }

  const deduped = new Map();
  parsed.forEach((row) => {
    if (row.full_code) deduped.set(row.full_code, row);
  });

  const rows = Array.from(deduped.values()).map((row) => ({
    base: row.base,
    checksum: row.checksum,
    full_code: row.full_code,
    status: 'AVAILABLE',
  }));

  if (!rows.length) {
    return res.status(400).json({ ok:false, error:'no valid codes found', errors });
  }

  const fullCodes = rows.map((row) => row.full_code);
  let existing = [];
  if (fullCodes.length) {
    const existingRes = await supabaseAdmin.from('ussd_pool').select('full_code').in('full_code', fullCodes);
    if (existingRes.error) return res.status(500).json({ ok:false, error: existingRes.error.message, errors });
    existing = existingRes.data || [];
  }
  const existingSet = new Set(existing.map((row) => row.full_code));
  const toInsert = rows.filter((row) => !existingSet.has(row.full_code));

  if (toInsert.length) {
    const { error } = await supabaseAdmin.from('ussd_pool').insert(toInsert);
    if (error) return res.status(500).json({ ok:false, error: error.message, errors });
  }

  await logAdminAction({
    req,
    action: 'ussd_import',
    resource_type: 'ussd_pool',
    resource_id: null,
    payload: { inserted: toInsert.length, skipped: rows.length - toInsert.length, total: rows.length },
  });

  res.json({
    ok: true,
    inserted: toInsert.length,
    skipped: rows.length - toInsert.length,
    errors,
  });
});

// Transactions for dashboard tables
router.get('/transactions/fees', async (_req,res)=>{
  const { data, error } = await supabaseAdmin.rpc('fees_today');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data||[] });
});
router.get('/transactions/loans', async (_req,res)=>{
  const { data, error } = await supabaseAdmin.rpc('loans_today');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data||[] });
});

// Staff, Loans (CRUD used by sacco dashboard)
router.get('/staff', async (req,res)=>{
  let q = supabaseAdmin.from('staff_profiles').select('*').order('created_at',{ascending:false});
  if (req.query.sacco_id) q = q.eq('sacco_id', req.query.sacco_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/staff', async (req,res)=>{
  const row = { sacco_id: req.body?.sacco_id, name: req.body?.name, phone: req.body?.phone, email: req.body?.email, role: req.body?.role||'SACCO_STAFF', user_id: req.body?.user_id||null };
  if(!row.sacco_id || !row.name) return res.status(400).json({error:'sacco_id and name are required'});
  const { data, error } = await supabaseAdmin.from('staff_profiles').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/loans', async (req,res)=>{
  let q = supabaseAdmin.from('loans').select('*').order('created_at',{ascending:false});
  if (req.query.sacco_id) q = q.eq('sacco_id', req.query.sacco_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/loans', async (req,res)=>{
  const row = { sacco_id: req.body?.sacco_id, matatu_id: req.body?.matatu_id||null, borrower_name: req.body?.borrower_name, principal_kes: req.body?.principal_kes||0, interest_rate_pct: req.body?.interest_rate_pct||0, term_months: req.body?.term_months||0, status: req.body?.status||'ACTIVE' };
  if(!row.sacco_id || !row.borrower_name) return res.status(400).json({error:'sacco_id and borrower_name are required'});
  const { data, error } = await supabaseAdmin.from('loans').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Routes and usage (system admin overview)
router.get('/routes', async (req,res)=>{
  try{
    let q = supabaseAdmin.from('routes').select('*').order('created_at',{ascending:false});
    if (req.query.sacco_id) q = q.eq('sacco_id', req.query.sacco_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data||[] });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load routes' });
  }
});

router.get('/routes/usage-summary', async (_req,res)=>{
  try{
    // basic usage: per sacco, count routes and recent trip_positions (last 7 days)
    const since = new Date(Date.now() - 7*24*3600*1000).toISOString();
    const [routesRes, posRes] = await Promise.all([
      supabaseAdmin.from('routes').select('id,sacco_id').order('sacco_id',{ascending:true}),
      supabaseAdmin
        .from('trip_positions')
        .select('id,sacco_id,route_id')
        .gte('recorded_at', since)
    ]);
    if (routesRes.error) throw routesRes.error;
    if (posRes.error) throw posRes.error;

    const bySacco = new Map();
    (routesRes.data||[]).forEach(r=>{
      const sid = String(r.sacco_id||'');
      if (!sid) return;
      const row = bySacco.get(sid) || { sacco_id: sid, routes:0, active_routes:0, trips_7d:0 };
      row.routes += 1;
      bySacco.set(sid,row);
    });
    const seenRoute = new Set();
    (posRes.data||[]).forEach(p=>{
      const sid = String(p.sacco_id||'');
      if (!sid) return;
      const row = bySacco.get(sid) || { sacco_id: sid, routes:0, active_routes:0, trips_7d:0 };
      row.trips_7d += 1;
      if (p.route_id && !seenRoute.has(p.route_id)){
        seenRoute.add(p.route_id);
        row.active_routes += 1;
      }
      bySacco.set(sid,row);
    });
    res.json({ items: Array.from(bySacco.values()) });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load routes usage summary' });
  }
});

// Create a new route (system admin only)
router.post('/routes', async (req,res)=>{
  try{
    const sacco_id = req.body?.sacco_id || null;
    const name = (req.body?.name || '').toString().trim();
    const code = (req.body?.code || '').toString().trim() || null;
    const start_stop = (req.body?.start_stop || '').toString().trim() || null;
    const end_stop = (req.body?.end_stop || '').toString().trim() || null;
    if (!name) return res.status(400).json({ error: 'name required' });

    let path_points = null;
    if (Array.isArray(req.body?.path_points)) {
      path_points = req.body.path_points
        .map(p => {
          const lat = Number(p.lat);
          const lng = Number(p.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const point = { lat, lng };
          if (p.ts) {
            try {
              point.ts = new Date(p.ts).toISOString();
            } catch {
              point.ts = null;
            }
          }
          return point;
        })
        .filter(Boolean);
      if (!path_points.length) {
        path_points = null;
      }
    }

    const row = { sacco_id, name, code, start_stop, end_stop, active: true, path_points };
    const { data, error } = await supabaseAdmin
      .from('routes')
      .insert(row)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to create route' });
  }
});

// Update an existing route (system admin only)
router.patch('/routes/:routeId', async (req,res)=>{
  const routeId = req.params.routeId;
  if (!routeId) return res.status(400).json({ error: 'routeId required' });
  try{
    const updates = {};
    if ('name' in req.body) {
      const name = (req.body?.name || '').toString().trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      updates.name = name;
    }
    if ('code' in req.body) {
      const code = (req.body?.code || '').toString().trim();
      updates.code = code || null;
    }
    if ('start_stop' in req.body) {
      const start_stop = (req.body?.start_stop || '').toString().trim();
      updates.start_stop = start_stop || null;
    }
    if ('end_stop' in req.body) {
      const end_stop = (req.body?.end_stop || '').toString().trim();
      updates.end_stop = end_stop || null;
    }
    if ('sacco_id' in req.body) {
      const sacco_id = req.body?.sacco_id || null;
      updates.sacco_id = sacco_id;
    }
    if ('active' in req.body) {
      updates.active = !!req.body.active;
    }

    if ('path_points' in req.body) {
      let path_points = null;
      if (Array.isArray(req.body?.path_points)) {
        path_points = req.body.path_points
          .map(p => {
            const lat = Number(p.lat);
            const lng = Number(p.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const point = { lat, lng };
            if (p.ts) {
              try {
                point.ts = new Date(p.ts).toISOString();
              } catch {
                point.ts = null;
              }
            }
            return point;
          })
          .filter(Boolean);
        if (!path_points.length) {
          path_points = null;
        }
      }
      updates.path_points = path_points;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const { data, error } = await supabaseAdmin
      .from('routes')
      .update(updates)
      .eq('id', routeId)
      .select('*')
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Route not found' });

    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to update route' });
  }
});

// Delete a route (system admin only)
router.delete('/routes/:routeId', requireSuperOnly, async (req,res)=>{
  const routeId = req.params.routeId;
  if (!routeId) return res.status(400).json({ error: 'routeId required' });
  try{
    const { error } = await supabaseAdmin
      .from('routes')
      .delete()
      .eq('id', routeId);
    if (error) return res.status(500).json({ error: error.message });
    await logAdminAction({
      req,
      action: 'route_delete',
      resource_type: 'route',
      resource_id: routeId,
      payload: {},
    });
    return res.json({ ok:true });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to delete route' });
  }
});

// Supabase health for admin routes
router.get('/health', async (_req, res) => {
  try{
    if (!supabaseAdmin) return res.status(500).json({ ok:false, error:'service_role_missing' });
    const { error } = await supabaseAdmin.from('saccos').select('id', { head:true, count:'exact' }).limit(1);
    if (error) return res.status(500).json({ ok:false, error: error.message });
    return res.json({ ok:true });
  }catch(e){
    return res.status(500).json({ ok:false, error: e.message || 'unknown' });
  }
});

router.__test = { mapC2bRow };

module.exports = router;
