const express = require('express');
const pool = require('../db/pool');
const { supabaseAdmin } = require('../supabase');
const { requireUser } = require('../middleware/auth');
const { checkB2CEnvPresence, buildBatchReadiness } = require('../services/payoutReadiness.service');

const router = express.Router();

if (!supabaseAdmin) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to serve payout readiness endpoints');
}

router.use(requireUser);

function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}

async function isSystemAdmin(userId) {
  const { data, error } = await supabaseAdmin
    .from('staff_profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'SYSTEM_ADMIN')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function getSaccoContext(userId) {
  const { data: roleRow, error } = await supabaseAdmin
    .from('user_roles')
    .select('role,sacco_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (roleRow?.sacco_id) {
    return { role: normalizeRole(roleRow.role), saccoId: roleRow.sacco_id };
  }
  const { data: staffRow, error: staffErr } = await supabaseAdmin
    .from('staff_profiles')
    .select('role,sacco_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (staffErr) throw staffErr;
  return { role: normalizeRole(staffRow?.role), saccoId: staffRow?.sacco_id || null };
}

router.get('/payout-batches/:id/readiness', async (req, res) => {
  const batchId = req.params.id;
  if (!batchId) return res.status(400).json({ ok: false, error: 'batch id required' });

  try {
    const batchRes = await pool.query(
      `
        SELECT id, status, sacco_id, date_from, date_to, total_amount
        FROM payout_batches
        WHERE id = $1
        LIMIT 1
      `,
      [batchId],
    );
    if (!batchRes.rows.length) return res.status(404).json({ ok: false, error: 'batch not found' });
    const batch = batchRes.rows[0];

    const uid = req.user?.id;
    const systemAdmin = uid ? await isSystemAdmin(uid) : false;
    if (!systemAdmin) {
      const ctx = await getSaccoContext(uid);
      if (!ctx.saccoId || String(ctx.saccoId) !== String(batch.sacco_id)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
    }

    const summaryRes = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_count,
          COUNT(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked_count,
          COUNT(*) FILTER (WHERE status = 'SENT')::int AS sent_count,
          COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed_count,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_count,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_count,
          COUNT(*) FILTER (WHERE status = 'PENDING' AND destination_type = 'MSISDN')::int AS pending_msisdn_count
        FROM payout_items
        WHERE batch_id = $1
      `,
      [batchId],
    );
    const summary = summaryRes.rows[0] || {};

    const blockedReasonsRes = await pool.query(
      `
        SELECT COALESCE(block_reason, 'UNSPECIFIED') AS reason, COUNT(*)::int AS count
        FROM payout_items
        WHERE batch_id = $1 AND status = 'BLOCKED'
        GROUP BY COALESCE(block_reason, 'UNSPECIFIED')
        ORDER BY count DESC
      `,
      [batchId],
    );

    const unverifiedRes = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM payout_items pi
        JOIN payout_batches b ON b.id = pi.batch_id
        LEFT JOIN payout_destinations pd
          ON pd.entity_type = 'SACCO'
         AND pd.entity_id = b.sacco_id
         AND pd.destination_type = pi.destination_type
         AND pd.destination_ref = pi.destination_ref
         AND pd.is_verified = true
        WHERE pi.batch_id = $1
          AND pi.status = 'PENDING'
          AND pi.destination_type = 'MSISDN'
          AND pd.id IS NULL
      `,
      [batchId],
    );

    const unverifiedDestRes = await pool.query(
      `
        SELECT DISTINCT pi.destination_ref, pi.destination_type
        FROM payout_items pi
        JOIN payout_batches b ON b.id = pi.batch_id
        LEFT JOIN payout_destinations pd
          ON pd.entity_type = 'SACCO'
         AND pd.entity_id = b.sacco_id
         AND pd.destination_type = pi.destination_type
         AND pd.destination_ref = pi.destination_ref
         AND pd.is_verified = true
        WHERE pi.batch_id = $1
          AND pi.status = 'PENDING'
          AND pi.destination_type = 'MSISDN'
          AND pd.id IS NULL
      `,
      [batchId],
    );

    const quarantinedRes = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM mpesa_c2b_payments p
        JOIN wallet_aliases wa
          ON wa.alias = p.account_reference
         AND wa.is_active = true
        JOIN wallets w
          ON w.id = wa.wallet_id
        WHERE w.sacco_id = $1
          AND p.status = 'QUARANTINED'
          AND p.created_at::date BETWEEN $2 AND $3
      `,
      [batch.sacco_id, batch.date_from, batch.date_to],
    );

    const envCheck = checkB2CEnvPresence(process.env);
    const readiness = buildBatchReadiness({
      batch,
      summary,
      pendingMsisdnCount: Number(summary.pending_msisdn_count || 0),
      unverifiedMsisdnCount: Number(unverifiedRes.rows[0]?.total || 0),
      quarantinesCount: Number(quarantinedRes.rows[0]?.total || 0),
      envCheck,
    });

    return res.json({
      ok: true,
      batch,
      checks: readiness.checks,
      items_summary: {
        pending_count: Number(summary.pending_count || 0),
        blocked_count: Number(summary.blocked_count || 0),
        sent_count: Number(summary.sent_count || 0),
        confirmed_count: Number(summary.confirmed_count || 0),
        failed_count: Number(summary.failed_count || 0),
        blocked_reasons: blockedReasonsRes.rows || [],
      },
      issues: readiness.issues || [],
      unverified_destinations: unverifiedDestRes.rows || [],
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
