const express = require('express');
const pool = require('../db/pool');
const { requireUser } = require('../middleware/auth');
const { resolveSaccoAuthContext } = require('../services/saccoAuth.service');
const { checkMatatuAccess } = require('../auth/matatuAccess');

const router = express.Router();

router.use(requireUser);

const ROLES = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  SACCO_ADMIN: 'SACCO_ADMIN',
  SACCO_STAFF: 'SACCO_STAFF',
  OWNER: 'OWNER',
  MATATU_STAFF: 'MATATU_STAFF',
  DRIVER: 'DRIVER',
};

function normalizeRoleName(role) {
  const raw = String(role || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'MATATU_OWNER' || raw === 'OWNER') return ROLES.OWNER;
  if (raw === 'SACCO' || raw === 'SACCO_ADMIN') return ROLES.SACCO_ADMIN;
  if (raw === 'SACCO_STAFF') return ROLES.SACCO_STAFF;
  if (raw === 'MATATU_STAFF') return ROLES.MATATU_STAFF;
  if (raw === 'DRIVER') return ROLES.DRIVER;
  if (raw === 'SYSTEM_ADMIN') return ROLES.SYSTEM_ADMIN;
  return raw;
}

function logLivePaymentsDebug(payload) {
  const enabled =
    String(process.env.DEBUG_MATATU_LIVE_PAYMENTS || '').toLowerCase() === 'true' ||
    String(process.env.DEBUG_MATATU_LIVE_PAYMENTS || '') === '1' ||
    String(process.env.DEBUG_LIVE_PAYMENTS || '').toLowerCase() === 'true' ||
    String(process.env.DEBUG_LIVE_PAYMENTS || '') === '1';
  if (!enabled) return;
  try {
    console.log('[matatu-live-payments]', payload);
  } catch {
    /* ignore */
  }
}

async function resolveUserContext(userId) {
  if (!userId) return null;
  const res = await pool.query(
    `
      SELECT effective_role, sacco_id, matatu_id
      FROM public.app_user_context
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );
  const row = res.rows[0] || null;
  if (!row) return null;
  const role = normalizeRoleName(row.effective_role);
  if (!role) return null;
  return {
    role,
    saccoId: row.sacco_id || null,
    matatuId: row.matatu_id || null,
  };
}

async function hasOwnerAccessGrant(userId, matatuId) {
  if (!userId || !matatuId) return false;
  const res = await pool.query(
    `
      SELECT 1
      FROM access_grants
      WHERE user_id = $1
        AND scope_id = $2
        AND is_active = true
        AND scope_type IN ('OWNER','MATATU')
      LIMIT 1
    `,
    [userId, matatuId],
  );
  return res.rows.length > 0;
}

async function hasMatatuStaffGrant(userId, matatuId) {
  if (!userId || !matatuId) return false;
  const res = await pool.query(
    `
      SELECT 1
      FROM access_grants
      WHERE user_id = $1
        AND scope_id = $2
        AND is_active = true
        AND scope_type IN ('MATATU','OWNER')
      LIMIT 1
    `,
    [userId, matatuId],
  );
  return res.rows.length > 0;
}

async function hasMatatuStaffProfileAssignment(userId, matatuId) {
  if (!userId || !matatuId) return false;
  const res = await pool.query(
    `
      SELECT 1
      FROM staff_profiles
      WHERE user_id = $1
        AND matatu_id = $2
      LIMIT 1
    `,
    [userId, matatuId],
  );
  return res.rows.length > 0;
}

async function resolveMatatuStaffAccess(userId, matatuId, saccoId) {
  if (!userId || !matatuId) return { allowed: false, params: {}, rowCount: 0 };
  const grantExists = await hasMatatuStaffGrant(userId, matatuId);
  const assignRes = await pool.query(
    `
      SELECT 1 FROM matatu_staff_assignments
      WHERE staff_user_id = $1 AND matatu_id = $2 AND ($3::uuid IS NULL OR sacco_id = $3)
      LIMIT 1
    `,
    [userId, matatuId, saccoId || null],
  );
  const assignmentExists = assignRes.rows.length > 0;
  const profileAssign = await hasMatatuStaffProfileAssignment(userId, matatuId);
  const staffGrant = grantExists || assignmentExists || profileAssign;
  return {
    allowed: staffGrant,
    rowCount: assignmentExists ? assignRes.rows.length : 0,
    params: { grantExists, assignmentExists, profileAssign, staffGrant },
  };
}

function normalizeFrom(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeLimit(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 50;
  return Math.min(Math.max(Math.floor(num), 1), 200);
}

router.get('/live-payments', async (req, res) => {
  const matatuId = (req.query.matatu_id || '').toString().trim();
  const limit = normalizeLimit(req.query.limit);
  const from = normalizeFrom(req.query.from) || new Date(Date.now() - 15 * 60 * 1000);

  if (!matatuId) {
    return res.status(400).json({
      ok: false,
      error: 'matatu_id required',
      request_id: req.requestId || null,
      code: 'MATATU_ID_REQUIRED',
    });
  }

  try {
    const access = await checkMatatuAccess(pool, { user_id: req.user?.id, matatu_id: matatuId });
    if (!access.allowed) {
      logLivePaymentsDebug({
        request_id: req.requestId || null,
        user_id: req.user?.id || null,
        role: access.details?.role || null,
        matatu_id: matatuId,
        ...access.details,
        reason: 'access_denied',
      });
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'MATATU_ACCESS_DENIED',
        request_id: req.requestId || null,
        details: {
          user_id: req.user?.id || null,
          role: access.details?.role || null,
          requested_matatu_id: matatuId,
          grantExists: access.details?.grantExists,
          assignmentExists: access.details?.assignmentExists,
          profileAssign: access.details?.profileAssign,
        },
      });
    }

    const params = [matatuId, from.toISOString(), limit];
    const { rows } = await pool.query(
      `
        SELECT
          p.id,
          COALESCE(p.received_at, p.created_at) AS received_at,
          p.created_at,
          p.amount,
          COALESCE(p.display_msisdn, p.msisdn_normalized, p.msisdn) AS msisdn,
          p.account_reference,
          p.receipt,
          p.status,
          p.match_status,
          COALESCE(w_alias.wallet_kind, w_match.wallet_kind) AS wallet_kind
        FROM mpesa_c2b_payments p
        LEFT JOIN wallet_aliases wa
          ON wa.alias = p.account_reference
         AND wa.is_active = true
        LEFT JOIN wallets w_alias
          ON w_alias.id = wa.wallet_id
        LEFT JOIN wallets w_match
          ON w_match.id = p.matched_wallet_id
        WHERE (w_alias.matatu_id = $1 OR w_match.matatu_id = $1)
          AND COALESCE(p.received_at, p.created_at) >= $2
        ORDER BY COALESCE(p.received_at, p.created_at) DESC
        LIMIT $3
      `,
      params,
    );

    logLivePaymentsDebug({
      request_id: req.requestId || null,
      matatu_id: matatuId,
      from: from.toISOString(),
      limit,
      rowcount: rows.length,
    });

    return res.json({
      ok: true,
      matatu_id: matatuId,
      from: from.toISOString(),
      payments: rows || [],
      request_id: req.requestId || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to load live payments',
      request_id: req.requestId || null,
    });
  }
});

router.get('/my-assignment', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'unauthorized', request_id: req.requestId || null });
    }

    const staffAssign = await pool.query(
      `
        SELECT matatu_id, sacco_id
        FROM matatu_staff_assignments
        WHERE staff_user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [userId],
    );
    const assignRow = staffAssign.rows[0] || null;

    let matatuId = assignRow?.matatu_id || null;
    let saccoId = assignRow?.sacco_id || null;

    if (!matatuId) {
      const prof = await pool.query(
        `SELECT matatu_id, sacco_id FROM staff_profiles WHERE user_id = $1 LIMIT 1`,
        [userId],
      );
      if (prof.rows.length) {
        matatuId = prof.rows[0].matatu_id || matatuId;
        saccoId = saccoId || prof.rows[0].sacco_id || null;
      }
    }

    if (!matatuId) {
      const grant = await pool.query(
        `
          SELECT scope_id AS matatu_id
          FROM access_grants
          WHERE user_id = $1
            AND scope_type IN ('OWNER','MATATU')
            AND is_active = true
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId],
      );
      if (grant.rows.length) {
        matatuId = grant.rows[0].matatu_id || matatuId;
      }
    }

    return res.json({
      ok: true,
      user_id: userId,
      role: req.user?.role || null,
      matatu_id: matatuId || null,
      sacco_id: saccoId || null,
      request_id: req.requestId || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to resolve assignment',
      request_id: req.requestId || null,
    });
  }
});

module.exports = router;
