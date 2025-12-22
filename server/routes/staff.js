const express = require('express');
const router = express.Router();
const { requireUser } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase');
const { validate } = require('../middleware/validate');
const { z } = require('zod');

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

// Insert a cash transaction using user-scoped client (RLS enforced)
router.post('/cash', requireUser, validate(staffCashSchema), async (req, res) => {
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

module.exports = router;
