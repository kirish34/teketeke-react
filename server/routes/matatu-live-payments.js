const express = require('express');
const pool = require('../db/pool');
const { requireUser } = require('../middleware/auth');
const { resolveSaccoAuthContext } = require('../services/saccoAuth.service');
const { ensureAppUserContextFromUserRoles } = require('../services/appUserContext.service');
const { extractSenderNameFromRaw } = require('../utils/msisdn');
const { resolveActiveShiftIdForMatatu, getActiveShift, openShift, closeShift } = require('../services/shift.service');

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
  if (raw === 'MATATU_STAFF' || raw === 'STAFF') return ROLES.MATATU_STAFF;
  if (raw === 'TAXI') return ROLES.DRIVER;
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

function needsContextRepair(row, roleNorm) {
  if (!row || !roleNorm) return true;
  if ([ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(roleNorm) && !row.matatu_id) return true;
  if ([ROLES.SACCO_ADMIN, ROLES.SACCO_STAFF].includes(roleNorm) && !row.sacco_id) return true;
  return false;
}

async function resolveUserContext(userId) {
  if (!userId) return null;
  let row = null;
  try {
    const res = await pool.query(
      `
        SELECT effective_role, sacco_id, matatu_id
        FROM public.app_user_context
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId],
    );
    row = res.rows[0] || null;
  } catch {
    row = null;
  }
  let role = normalizeRoleName(row?.effective_role);
  if (needsContextRepair(row, role)) {
    try {
      const repaired = await ensureAppUserContextFromUserRoles(userId, null);
      if (repaired) {
        row = repaired;
        role = normalizeRoleName(repaired.effective_role);
      }
    } catch {
      // ignore repair failures
    }
  }
  if (!row || !role) return null;
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
      SELECT matatu_id, sacco_id FROM matatu_staff_assignments
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
    params: {
      grantExists,
      assignmentExists,
      profileAssign,
      staffGrant,
      assignmentMatatuId: assignRes.rows[0]?.matatu_id || null,
    },
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

async function resolveUserMatatuAssignment(userId) {
  if (!userId) return { matatuId: null, saccoId: null };

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
    const ctxRes = await pool.query(
      `SELECT matatu_id, sacco_id FROM public.app_user_context WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (ctxRes.rows.length) {
      matatuId = ctxRes.rows[0].matatu_id || matatuId;
      saccoId = saccoId || ctxRes.rows[0].sacco_id || null;
    }
  }

  if (!matatuId) {
    const roleRes = await pool.query(
      `
        SELECT matatu_id, sacco_id
        FROM public.user_roles
        WHERE user_id = $1
        ORDER BY created_at DESC NULLS LAST, updated_at DESC NULLS LAST
        LIMIT 1
      `,
      [userId],
    );
    if (roleRes.rows.length) {
      matatuId = roleRes.rows[0].matatu_id || matatuId;
      saccoId = saccoId || roleRes.rows[0].sacco_id || null;
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

  return { matatuId: matatuId || null, saccoId: saccoId || null };
}

router.get('/live-payments', async (req, res) => {
  const matatuId = (req.query.matatu_id || '').toString().trim();
  const tripId = (req.query.trip_id || '').toString().trim() || null;
  const shiftIdQuery = (req.query.shift_id || '').toString().trim() || null;
  const confirmedParam = (req.query.confirmed || '0').toString().trim();
  const confirmedFilter = confirmedParam === '1' ? 1 : 0;
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
    const matatuRes = await pool.query(`SELECT id, sacco_id, created_by FROM matatus WHERE id = $1 LIMIT 1`, [matatuId]);
    const matatu = matatuRes.rows[0] || null;
    if (!matatu) {
      return res.status(404).json({ ok: false, error: 'matatu not found', request_id: req.requestId || null });
    }

    const ctxFromDb = await resolveUserContext(req.user?.id);
    const normalizedRole = normalizeRoleName(ctxFromDb?.role || req.user?.role);
    const userCtx = ctxFromDb || { role: normalizedRole, saccoId: null, matatuId: null };
    const membershipCtx = (await resolveSaccoAuthContext({ userId: req.user?.id })) || { allowed_sacco_ids: [] };
    const staffAccess = await resolveMatatuStaffAccess(req.user?.id, matatu.id, matatu.sacco_id);

    const superUser = userCtx?.role === ROLES.SYSTEM_ADMIN;
    const saccoScoped =
      [ROLES.SACCO_ADMIN].includes(userCtx?.role) &&
      userCtx?.saccoId &&
      matatu.sacco_id &&
      String(userCtx.saccoId) === String(matatu.sacco_id);
    const saccoMembershipScoped =
      [ROLES.SACCO_ADMIN, ROLES.SACCO_STAFF, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx?.role) &&
      Array.isArray(membershipCtx.allowed_sacco_ids) &&
      matatu.sacco_id &&
      membershipCtx.allowed_sacco_ids.some((sid) => String(sid) === String(matatu.sacco_id));
    const matatuScoped =
      [ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx?.role) &&
      (userCtx?.matatuId || staffAccess.params?.assignmentMatatuId) &&
      String(userCtx?.matatuId || staffAccess.params?.assignmentMatatuId) === String(matatu.id);
    const ownerOfMatatu = matatu.created_by && req.user?.id && String(matatu.created_by) === String(req.user.id);
    let ownerGrantScoped = false;
    if (userCtx?.role === ROLES.OWNER && !ownerOfMatatu) {
      ownerGrantScoped = await hasOwnerAccessGrant(req.user?.id, matatu.id);
    }
    const staffGrant = [ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx?.role) && staffAccess.allowed;
    const ownerGrant = ownerOfMatatu || ownerGrantScoped;
    const allowed =
      superUser ||
      saccoScoped ||
      saccoMembershipScoped ||
      matatuScoped ||
      staffGrant ||
      ownerGrant;

    if (!allowed) {
      logLivePaymentsDebug({
        request_id: req.requestId || null,
        user_id: req.user?.id || null,
        role: userCtx?.role || null,
        matatu_id: matatuId,
        sacco_id: matatu.sacco_id || null,
        staffGrant,
        grantExists: staffAccess.params?.grantExists,
        assignmentExists: staffAccess.params?.assignmentExists,
        profileAssign: staffAccess.params?.profileAssign,
        ownerGrant,
        saccoScoped,
        matatuScoped,
        allowed_sacco_ids: membershipCtx.allowed_sacco_ids || [],
        reason: 'access_denied',
      });
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'MATATU_ACCESS_DENIED',
        request_id: req.requestId || null,
        details: {
          user_id: req.user?.id || null,
          role: userCtx?.role || null,
          requested_matatu_id: matatuId,
          grantExists: staffAccess.params?.grantExists,
          assignmentExists: staffAccess.params?.assignmentExists,
          profileAssign: staffAccess.params?.profileAssign,
          user_matatu_id: userCtx?.matatuId || null,
          allowed_sacco_ids: membershipCtx.allowed_sacco_ids || [],
        },
      });
    }

    const params = [matatuId, from.toISOString()];
    if (tripId) {
      const tripRes = await pool.query(`SELECT id, matatu_id FROM matatu_trips WHERE id = $1 LIMIT 1`, [tripId]);
      const tripRow = tripRes.rows[0] || null;
      if (!tripRow) {
        return res.status(404).json({
          ok: false,
          error: 'trip not found',
          code: 'TRIP_NOT_FOUND',
          request_id: req.requestId || null,
        });
      }
      if (String(tripRow.matatu_id) !== String(matatu.id)) {
        return res.status(403).json({
          ok: false,
          error: 'trip does not belong to matatu',
          code: 'TRIP_MISMATCH',
          request_id: req.requestId || null,
        });
      }
    }

    let shiftFilterId = null;
    if ([ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx?.role)) {
      shiftFilterId = await resolveActiveShiftIdForMatatu(matatu.id, req.user?.id);
      if (!shiftFilterId) {
        return res.status(403).json({
          ok: false,
          error: 'shift required',
          code: 'SHIFT_REQUIRED',
          request_id: req.requestId || null,
          details: { matatu_id: matatu.id, user_id: req.user?.id || null },
        });
      }
    } else if (shiftIdQuery) {
      const shiftRes = await pool.query(`SELECT id, matatu_id FROM matatu_shifts WHERE id = $1 LIMIT 1`, [shiftIdQuery]);
      const shiftRow = shiftRes.rows[0] || null;
      if (!shiftRow) {
        return res.status(404).json({
          ok: false,
          error: 'shift not found',
          code: 'SHIFT_NOT_FOUND',
          request_id: req.requestId || null,
        });
      }
      if (String(shiftRow.matatu_id) !== String(matatu.id)) {
        return res.status(403).json({
          ok: false,
          error: 'shift does not belong to matatu',
          code: 'SHIFT_MISMATCH',
          request_id: req.requestId || null,
        });
      }
      shiftFilterId = shiftRow.id;
    }

    const where = [
      '(w_alias.matatu_id = $1 OR w_match.matatu_id = $1)',
      'COALESCE(p.trans_time, p.created_at) >= $2',
    ];
    if (confirmedFilter === 1) {
      where.push('p.confirmed_at IS NOT NULL');
    } else {
      where.push('p.confirmed_at IS NULL');
    }
    if (tripId) {
      params.push(tripId);
      where.push(`p.trip_id = $${params.length}`);
    }
    if (shiftFilterId) {
      params.push(shiftFilterId);
      where.push(`p.shift_id = $${params.length}`);
    }
    params.push(limit);
    const { rows } = await pool.query(
      `
        SELECT
          p.id,
          COALESCE(p.trans_time, p.created_at) AS received_at,
          p.created_at,
          p.amount,
          COALESCE(p.display_msisdn, p.msisdn_normalized, p.msisdn) AS msisdn,
          sc.sender_name AS sender_name_db,
          p.account_reference,
          p.receipt,
          p.status,
          p.match_status,
          p.trip_id,
          p.shift_id,
          p.confirmed_at,
          p.confirmed_by,
          p.confirmed_shift_id,
          COALESCE(w_alias.wallet_kind, w_match.wallet_kind) AS wallet_kind,
          p.raw,
          p.raw_payload,
          COALESCE(p.msisdn_normalized, p.msisdn, p.display_msisdn) AS msisdn_lookup
        FROM mpesa_c2b_payments p
        LEFT JOIN sender_contacts sc
          ON sc.msisdn = COALESCE(p.msisdn_normalized, p.msisdn, p.display_msisdn)
        LEFT JOIN wallet_aliases wa
          ON wa.alias = p.account_reference
         AND wa.is_active = true
        LEFT JOIN wallets w_alias
          ON w_alias.id = wa.wallet_id
        LEFT JOIN wallets w_match
          ON w_match.id = p.matched_wallet_id
        WHERE ${where.join('\n          AND ')}
        ORDER BY COALESCE(p.trans_time, p.created_at) DESC
        LIMIT $${params.length}
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

    const payments = (rows || []).map(({ raw, raw_payload, sender_name_db, ...rest }) => ({
      ...rest,
      sender_name: sender_name_db || extractSenderNameFromRaw(raw || raw_payload),
    }));

    return res.json({
      ok: true,
      matatu_id: matatuId,
      from: from.toISOString(),
      payments,
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

    const { matatuId, saccoId } = await resolveUserMatatuAssignment(userId);

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

router.get('/shifts/active', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'unauthorized', request_id: req.requestId || null });
    }
    const { matatuId } = await resolveUserMatatuAssignment(userId);
    if (!matatuId) {
      return res.json({
        ok: true,
        shift: null,
        matatu_id: null,
        request_id: req.requestId || null,
      });
    }
    const shift = await getActiveShift(matatuId, userId);
    return res.json({
      ok: true,
      shift: shift || null,
      matatu_id: matatuId,
      request_id: req.requestId || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to load active shift',
      request_id: req.requestId || null,
    });
  }
});

router.post('/shifts/open', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'unauthorized', request_id: req.requestId || null });
    }
    const matatuIdFromBody = (req.body?.matatu_id || '').toString().trim() || null;
    const { matatuId: resolvedMatatuId, saccoId } = await resolveUserMatatuAssignment(userId);
    const matatuId = matatuIdFromBody || resolvedMatatuId;
    if (!matatuId) {
      return res.status(403).json({
        ok: false,
        error: 'No matatu assignment found',
        code: 'MATATU_ACCESS_DENIED',
        request_id: req.requestId || null,
      });
    }
    const staffAccess = await resolveMatatuStaffAccess(userId, matatuId, saccoId);
    // allow opening shift if the user has a matatu resolved; still record staff access for diagnostics
    const allowed = staffAccess.allowed || !!matatuId;
    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'MATATU_ACCESS_DENIED',
        request_id: req.requestId || null,
        details: staffAccess.params,
      });
    }

    const shift = await openShift(matatuId, userId);
    return res.json({ ok: true, shift, matatu_id: matatuId, request_id: req.requestId || null });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to open shift',
      request_id: req.requestId || null,
    });
  }
});

router.post('/shifts/close', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'unauthorized', request_id: req.requestId || null });
    }
    const role = normalizeRoleName(req.user?.role);
    const superUser = role === ROLES.SYSTEM_ADMIN;
    const shiftIdFromBody = (req.body?.shift_id || '').toString().trim() || null;

    const matatuIdFromBody = (req.body?.matatu_id || '').toString().trim() || null;
    const { matatuId: resolvedMatatuId, saccoId } = await resolveUserMatatuAssignment(userId);
    const matatuId = matatuIdFromBody || resolvedMatatuId;
    const staffAccess = matatuId ? await resolveMatatuStaffAccess(userId, matatuId, saccoId) : { allowed: false, params: {} };

    let targetShift = null;
    if (shiftIdFromBody) {
      const shiftRes = await pool.query(`SELECT * FROM matatu_shifts WHERE id = $1 LIMIT 1`, [shiftIdFromBody]);
      targetShift = shiftRes.rows[0] || null;
    } else if (matatuId) {
      targetShift = await getActiveShift(matatuId, userId);
    }

    if (!targetShift) {
      return res.status(404).json({
        ok: false,
        error: 'shift not found',
        code: 'SHIFT_NOT_FOUND',
        request_id: req.requestId || null,
      });
    }

    const ownerGrant = await hasOwnerAccessGrant(userId, targetShift.matatu_id);
    const allowed =
      superUser ||
      targetShift.staff_user_id === userId ||
      ownerGrant ||
      ([ROLES.MATATU_STAFF, ROLES.DRIVER].includes(role) && (staffAccess.allowed || !!matatuId));
    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'MATATU_ACCESS_DENIED',
        request_id: req.requestId || null,
      });
    }

    const closed = await closeShift(targetShift.id, userId);
    return res.json({ ok: true, shift: closed, request_id: req.requestId || null });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to close shift',
      request_id: req.requestId || null,
    });
  }
});

router.post('/payments/:paymentId/confirm', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', request_id: req.requestId || null });
    const paymentId = (req.params.paymentId || '').toString().trim();
    if (!paymentId) return res.status(400).json({ ok: false, error: 'payment_id required', request_id: req.requestId || null });

    // resolve payment and matatu
    const payRes = await pool.query(
      `
        SELECT p.id, p.account_reference, p.matched_wallet_id,
               p.trip_id, p.shift_id,
               p.confirmed_at, p.confirmed_by, p.confirmed_shift_id,
               wa.wallet_id AS alias_wallet_id,
               w_alias.matatu_id AS alias_matatu_id,
               w_match.matatu_id AS matched_matatu_id
        FROM mpesa_c2b_payments p
        LEFT JOIN wallet_aliases wa
          ON wa.alias = p.account_reference AND wa.is_active = true
        LEFT JOIN wallets w_alias
          ON w_alias.id = wa.wallet_id
        LEFT JOIN wallets w_match
          ON w_match.id = p.matched_wallet_id
        WHERE p.id = $1
        LIMIT 1
      `,
      [paymentId],
    );
    const pay = payRes.rows[0] || null;
    if (!pay) return res.status(404).json({ ok: false, error: 'payment not found', request_id: req.requestId || null });

    const matatuIdResolved = pay.alias_matatu_id || pay.matched_matatu_id || null;

    if (!matatuIdResolved) {
      return res.status(400).json({ ok: false, error: 'payment not linked to matatu', request_id: req.requestId || null });
    }

    const staffAccess = await resolveMatatuStaffAccess(userId, matatuIdResolved, null);
    if (!staffAccess.allowed) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'MATATU_ACCESS_DENIED',
        request_id: req.requestId || null,
      });
    }

    const activeShiftId = await resolveActiveShiftIdForMatatu(matatuIdResolved, userId);
    if (!activeShiftId) {
      return res.status(403).json({
        ok: false,
        error: 'shift required',
        code: 'SHIFT_REQUIRED',
        request_id: req.requestId || null,
      });
    }

    await pool.query(
      `
        UPDATE mpesa_c2b_payments
        SET confirmed_at = COALESCE(confirmed_at, now()),
            confirmed_by = COALESCE(confirmed_by, $2),
            confirmed_shift_id = COALESCE(confirmed_shift_id, $3),
            shift_id = COALESCE(shift_id, $3)
        WHERE id = $1
      `,
      [paymentId, userId, activeShiftId],
    );

    return res.json({
      ok: true,
      payment_id: paymentId,
      confirmed_at: new Date().toISOString(),
      shift_id: activeShiftId,
      request_id: req.requestId || null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to confirm payment', request_id: req.requestId || null });
  }
});

module.exports = router;
