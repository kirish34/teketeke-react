const express = require('express');
const router = express.Router();
const pool = process.env.NODE_ENV === 'test' && global.__testPool ? global.__testPool : require('../db/pool');
const { requireUser } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase');
const { validate } = require('../middleware/validate');
const { z } = require('zod');
const { requireSaccoAccess, getSaccoContextUnified } = require('../services/saccoContext.service');
const { resolveSaccoAuthContext, normalizeRole: normalizeSaccoRole } = require('../services/saccoAuth.service');

// Accept broader inputs for SACCO Staff UI and normalize
const staffCashSchema = z.object({
  sacco_id: z.string().uuid(),
  matatu_id: z.string().uuid().optional().nullable(),
  kind: z.enum(['SACCO_FEE','SAVINGS','LOAN_REPAY','CASH','DAILY_FEE']).default('SACCO_FEE'),
  amount: z.number().int().positive().max(1_000_000),
  payer_name: z.string().min(0).max(120).optional().default(''),
  // Allow either E.164 2547xxxxxxxx, local 07xxxxxxxx, or empty string
  payer_phone: z.union([
      z.literal(''),
      z.string().regex(/^(2547\d{8}|07\d{8})$/u, 'Phone must be 2547xxxxxxxx or 07xxxxxxxx')
    ])
    .optional()
    .default(''),
  notes: z.string().max(500).optional().default('')
});

const tripPositionsSchema = z.object({
  sacco_id: z.string().uuid(),
  matatu_id: z.string().uuid(),
  route_id: z.string().uuid().optional().nullable(),
  trip_id: z.string().min(1).max(64).optional().nullable(),
  points: z.array(z.object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    ts: z.string().optional().nullable()
  })).min(1)
});
const startTripSchema = z.object({
  sacco_id: z.string().uuid(),
  matatu_id: z.string().uuid(),
  route_id: z.string().uuid().optional().nullable()
});
const endTripSchema = z.object({
  trip_id: z.string().uuid()
});

router.use(requireUser);
router.use(requireSaccoAccess());

async function ensureMatatuTripAccess({ userId, matatuId }) {
  const matatuRes = await pool.query(`SELECT id, sacco_id FROM matatus WHERE id = $1 LIMIT 1`, [matatuId]);
  const matatu = matatuRes.rows[0] || null;
  if (!matatu) return { ok: false, status: 404, error: 'matatu_not_found' };
  const ctxUnified = await getSaccoContextUnified(userId);
  const membership = await resolveSaccoAuthContext({ userId });
  const role = normalizeSaccoRole(ctxUnified.role || membership.effective_role);
  const saccoMatch =
    matatu.sacco_id &&
    Array.isArray(membership.allowed_sacco_ids) &&
    membership.allowed_sacco_ids.some((sid) => String(sid) === String(matatu.sacco_id));
  const matatuMatch = ctxUnified.matatuId && String(ctxUnified.matatuId) === String(matatu.id);
  const ownerMatch = matatuMatch; // treat assigned matatu as ownership for staff scope
  const allowed =
    role === 'SYSTEM_ADMIN' ||
    role === 'SACCO_ADMIN' ||
    (role === 'SACCO_STAFF' && (saccoMatch || matatuMatch)) ||
    (role === 'MATATU_STAFF' && (ownerMatch || saccoMatch || matatuMatch));
  if (!allowed) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true, matatu, sacco_id: matatu.sacco_id || null };
}

// Insert a cash transaction using user-scoped client (RLS enforced)
router.post('/cash', validate(staffCashSchema), async (req, res) => {
  try {
    let { sacco_id, matatu_id, kind, amount, payer_name, payer_phone, notes } = req.body;

    if (kind === 'DAILY_FEE') kind = 'SACCO_FEE';
    if (payer_phone && /^07\d{8}$/.test(payer_phone)) payer_phone = '254' + payer_phone.slice(1);

    // Attempt to resolve friendly staff name (optional)
    let created_by_name = null;
    try {
      if (supabaseAdmin) {
        const { data: prof } = await supabaseAdmin
          .from('staff_profiles')
          .select('name')
          .eq('user_id', req.user.id)
          .eq('sacco_id', sacco_id)
          .maybeSingle();
        created_by_name = prof?.name || null;
      } else {
        const { data: prof } = await req.supa
          .from('staff_profiles')
          .select('name')
          .eq('user_id', req.user.id)
          .eq('sacco_id', sacco_id)
          .maybeSingle();
        created_by_name = prof?.name || null;
      }
    } catch(_) { /* optional */ }

    const row = {
      sacco_id,
      matatu_id: matatu_id || null,
      kind,
      fare_amount_kes: amount,
      service_fee_kes: 0,
      status: 'SUCCESS',
      passenger_msisdn: payer_phone || null,
      notes: (notes || payer_name || '').toString(),
      created_by: req.user?.id || null,
      created_by_email: req.user?.email || null,
      created_by_name: created_by_name || (req.user?.email ? String(req.user.email).split('@')[0] : null)
    };

    // First try with user-scoped client (RLS)
    // Try inserting with audit columns; if schema not migrated yet, retry without them
    let ins = await req.supa.from('transactions').insert(row).select('*').single();
    if (ins.error && /column .* does not exist/i.test(String(ins.error.message||''))) {
      const fallbackRow = { ...row };
      delete fallbackRow.created_by;
      delete fallbackRow.created_by_email;
      delete fallbackRow.created_by_name;
      ins = await req.supa.from('transactions').insert(fallbackRow).select('*').single();
    }
    if (!ins.error && ins.data) return res.json(ins.data);

    // Fallback: verify authorization and upsert using service role to avoid RLS recursion issues
    if (supabaseAdmin) {
      // Check this user is allowed to write for the sacco
      // 1) staff_profiles (SYSTEM_ADMIN or matching sacco_id)
      // 2) user_roles with matching sacco_id (or matatu.role whose sacco matches)
      let allowed = false;
      try {
        const { data: profs } = await supabaseAdmin
          .from('staff_profiles')
          .select('role,sacco_id')
          .eq('user_id', req.user.id);
        if (Array.isArray(profs)) {
          allowed = profs.some(r => r.role === 'SYSTEM_ADMIN' || String(r.sacco_id) === String(sacco_id));
        }
      } catch (_) {}

      if (!allowed) {
        try {
          const { data: roles } = await supabaseAdmin
            .from('user_roles')
            .select('role,sacco_id,matatu_id')
            .eq('user_id', req.user.id);
          if (Array.isArray(roles)) {
            allowed = roles.some(r => String(r.sacco_id || '') === String(sacco_id));
            if (!allowed) {
              const matatuIds = (roles || []).map(r => r.matatu_id).filter(Boolean);
              if (matatuIds.length) {
                const { data: mats } = await supabaseAdmin
                  .from('matatus')
                  .select('id,sacco_id')
                  .in('id', matatuIds);
                if (Array.isArray(mats)) {
                  allowed = mats.some(m => String(m.sacco_id) === String(sacco_id));
                }
              }
            }
          }
        } catch (_) {}
      }

      if (!allowed) {
        const msg = ins?.error?.message || 'Forbidden';
        return res.status(403).json({ error: msg });
      }

      let alt = await supabaseAdmin.from('transactions').insert(row).select('*').single();
      if (alt.error && /column .* does not exist/i.test(String(alt.error.message||''))) {
        const fb = { ...row };
        delete fb.created_by;
        delete fb.created_by_email;
        delete fb.created_by_name;
        alt = await supabaseAdmin.from('transactions').insert(fb).select('*').single();
      }
      if (alt.error) return res.status(500).json({ error: alt.error.message || 'Failed to record cash entry' });
      return res.json(alt.data);
    }

    // No admin client available -- surface the original error
    return res.status(403).json({ error: ins?.error?.message || 'Forbidden' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to record cash entry' });
  }
});

// Record GPS points for an in-progress staff trip
router.post('/trips/positions', requireUser, validate(tripPositionsSchema), async (req,res)=>{
  try{
    const { sacco_id, matatu_id, route_id = null, trip_id = null, points } = req.body;
    const rows = points.map(p => ({
      sacco_id,
      matatu_id,
      staff_user_id: req.user.id,
      route_id,
      trip_id: trip_id || null,
      lat: p.lat,
      lng: p.lng,
      recorded_at: p.ts ? new Date(p.ts).toISOString() : new Date().toISOString()
    }));
    const { error } = await req.supa.from('trip_positions').insert(rows);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ inserted: rows.length });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to record trip positions' });
  }
});

async function computeTripTotals(matatuId, startedAt, endedAt) {
  const start = startedAt ? new Date(startedAt) : null;
  const end = endedAt ? new Date(endedAt) : new Date();
  const bounds = [];
  const params = [matatuId];
  if (start && !Number.isNaN(start.getTime())) {
    params.push(start.toISOString());
    bounds.push(`COALESCE(p.trans_time, p.created_at) >= $${params.length}`);
  }
  if (end && !Number.isNaN(end.getTime())) {
    params.push(end.toISOString());
    bounds.push(`COALESCE(p.trans_time, p.created_at) <= $${params.length}`);
  }
  const where = bounds.length ? `AND ${bounds.join(' AND ')}` : '';

  const mpesaRes = await pool.query(
    `
      SELECT
        COUNT(*)::int AS mpesa_count,
        COALESCE(SUM(p.amount), 0)::numeric AS mpesa_amount
      FROM mpesa_c2b_payments p
      LEFT JOIN wallet_aliases wa
        ON wa.alias = p.account_reference
       AND wa.is_active = true
      LEFT JOIN wallets w_alias
        ON w_alias.id = wa.wallet_id
      LEFT JOIN wallets w_match
        ON w_match.id = p.matched_wallet_id
      WHERE (w_alias.matatu_id = $1 OR w_match.matatu_id = $1)
      ${where}
    `,
    params,
  );

  const cashRes = await pool.query(
    `
      SELECT
        COUNT(*)::int AS cash_count,
        COALESCE(SUM(fare_amount_kes), 0)::numeric AS cash_amount
      FROM transactions
      WHERE matatu_id = $1
        AND kind = 'CASH'
        ${start ? `AND created_at >= $2` : ''}
        ${start && end ? `AND created_at <= $3` : end ? `AND created_at <= $2` : ''}
    `,
    (() => {
      if (!start && !end) return [matatuId];
      if (start && !end) return [matatuId, start.toISOString()];
      if (!start && end) return [matatuId, end.toISOString()];
      return [matatuId, start.toISOString(), end.toISOString()];
    })(),
  );

  const mpesaRow = mpesaRes.rows[0] || { mpesa_amount: 0, mpesa_count: 0 };
  const cashRow = cashRes.rows[0] || { cash_amount: 0, cash_count: 0 };
  return {
    mpesa_amount: Number(mpesaRow.mpesa_amount || 0),
    mpesa_count: Number(mpesaRow.mpesa_count || 0),
    cash_amount: Number(cashRow.cash_amount || 0),
    cash_count: Number(cashRow.cash_count || 0),
  };
}

router.post('/trips/start', validate(startTripSchema), async (req, res) => {
  try {
    const { sacco_id, matatu_id, route_id = null } = req.body;
    const access = await ensureMatatuTripAccess({ userId: req.user?.id, matatuId: matatu_id });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const existing = await pool.query(
      `SELECT * FROM matatu_trips WHERE matatu_id = $1 AND status = 'IN_PROGRESS' ORDER BY started_at DESC LIMIT 1`,
      [matatu_id],
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'trip_already_running', trip: existing.rows[0] });
    }
    const insert = await pool.query(
      `
        INSERT INTO matatu_trips (sacco_id, matatu_id, route_id, status, started_by_user_id)
        VALUES ($1, $2, $3, 'IN_PROGRESS', $4)
        RETURNING *
      `,
      [sacco_id, matatu_id, route_id || null, req.user?.id || null],
    );
    const trip = insert.rows[0] || null;
    return res.json({ trip });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to start trip' });
  }
});

router.post('/trips/end', validate(endTripSchema), async (req, res) => {
  try {
    const { trip_id } = req.body;
    const tripRes = await pool.query(`SELECT * FROM matatu_trips WHERE id = $1 LIMIT 1`, [trip_id]);
    const trip = tripRes.rows[0] || null;
    if (!trip) return res.status(404).json({ error: 'trip_not_found' });
    if (trip.status === 'ENDED') return res.json({ trip });
    const access = await ensureMatatuTripAccess({ userId: req.user?.id, matatuId: trip.matatu_id });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const totals = await computeTripTotals(trip.matatu_id, trip.started_at, new Date());
    const endAt = new Date();
    const update = await pool.query(
      `
        UPDATE matatu_trips
        SET status = 'ENDED',
            ended_at = $2,
            ended_by_user_id = $3,
            mpesa_amount = $4,
            mpesa_count = $5,
            cash_amount = $6,
            cash_count = $7
        WHERE id = $1
        RETURNING *
      `,
      [
        trip_id,
        endAt.toISOString(),
        req.user?.id || null,
        totals.mpesa_amount,
        totals.mpesa_count,
        totals.cash_amount,
        totals.cash_count,
      ],
    );
    return res.json({ trip: update.rows[0] || null });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to end trip' });
  }
});

router.get('/trips/current', async (req, res) => {
  try {
    const matatuId = (req.query.matatu_id || '').toString().trim();
    if (!matatuId) return res.status(400).json({ error: 'matatu_id required' });
    const access = await ensureMatatuTripAccess({ userId: req.user?.id, matatuId });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const tripRes = await pool.query(
      `
        SELECT *
        FROM matatu_trips
        WHERE matatu_id = $1
        ORDER BY status = 'IN_PROGRESS' DESC, started_at DESC
        LIMIT 1
      `,
      [matatuId],
    );
    const trip = tripRes.rows[0] || null;
    if (!trip) return res.status(404).json({ error: 'trip_not_found' });
    const totals = await computeTripTotals(matatuId, trip.started_at, trip.status === 'ENDED' ? trip.ended_at : new Date());
    return res.json({
      trip: {
        ...trip,
        mpesa_amount: totals.mpesa_amount,
        mpesa_count: totals.mpesa_count,
        cash_amount: totals.cash_amount,
        cash_count: totals.cash_count,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to load trip' });
  }
});

module.exports = router;
