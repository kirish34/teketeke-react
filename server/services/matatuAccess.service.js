const poolDefault = require('../db/pool');
const { ensureAppUserContextFromUserRoles, normalizeEffectiveRole } = require('./appUserContext.service');
const { resolveSaccoAuthContext } = require('./saccoAuth.service');

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

async function resolveUserContext(userId, pool = poolDefault) {
  if (!userId) return null;
  const loadCtx = async () => {
    const res = await pool.query(
      `
        SELECT effective_role, sacco_id, matatu_id
        FROM public.app_user_context
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId],
    );
    return res.rows[0] || null;
  };

  const needsRepair = (row, roleNorm) => {
    if (!row || !roleNorm) return true;
    if (roleNorm === 'USER' || roleNorm === 'PENDING') return true;
    if ([ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(roleNorm) && !row.matatu_id) return true;
    return false;
  };

  let row = await loadCtx();
  let role = normalizeRoleName(row?.effective_role);
  if (needsRepair(row, role)) {
    try {
      const repaired = await ensureAppUserContextFromUserRoles(userId, row?.email || null);
      if (repaired) {
        row = repaired;
        role = normalizeRoleName(normalizeEffectiveRole(repaired.effective_role));
      }
    } catch {
      // ignore repair failure
    }
  }
  if (!row || !role) return null;
  return {
    role,
    saccoId: row.sacco_id || null,
    matatuId: row.matatu_id || null,
  };
}

async function hasOwnerAccessGrant(userId, matatuId, pool = poolDefault) {
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

async function hasMatatuStaffGrant(userId, matatuId, pool = poolDefault) {
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

async function hasMatatuStaffProfileAssignment(userId, matatuId, pool = poolDefault) {
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

async function resolveMatatuStaffAccess(userId, matatuId, saccoId, pool = poolDefault) {
  if (!userId || !matatuId) return { allowed: false, rowCount: 0, params: {} };
  const grantExists = await hasMatatuStaffGrant(userId, matatuId, pool);
  const assignRes = await pool.query(
    `
      SELECT 1 FROM matatu_staff_assignments
      WHERE staff_user_id = $1 AND matatu_id = $2 AND ($3::uuid IS NULL OR sacco_id = $3)
      LIMIT 1
    `,
    [userId, matatuId, saccoId || null],
  );
  const assignmentExists = assignRes.rows.length > 0;
  const profileAssign = await hasMatatuStaffProfileAssignment(userId, matatuId, pool);
  const staffGrant = grantExists || assignmentExists || profileAssign;
  return {
    allowed: staffGrant,
    rowCount: assignmentExists ? assignRes.rows.length : 0,
    params: { grantExists, assignmentExists, profileAssign, staffGrant },
  };
}

async function resolveMatatuAccess({ userId, matatuId, matatuRow = null, pool = poolDefault, requestId = null }) {
  if (!matatuId) return { ok: false, reason: 'matatu_id_missing', details: { request_id: requestId } };

  let matatu = matatuRow;
  if (!matatu) {
    const matatuRes = await pool.query(`SELECT id, sacco_id, created_by FROM matatus WHERE id = $1 LIMIT 1`, [matatuId]);
    matatu = matatuRes.rows[0] || null;
  }
  if (!matatu) return { ok: false, reason: 'matatu_not_found', details: { request_id: requestId } };

  const userCtx = await resolveUserContext(userId, pool);
  const membershipCtx = await resolveSaccoAuthContext({ userId, pool });

  const superUser = userCtx?.role === ROLES.SYSTEM_ADMIN;
  const saccoScoped =
    [ROLES.SACCO_ADMIN].includes(userCtx?.role) &&
    userCtx?.saccoId &&
    matatu.sacco_id &&
    String(userCtx.saccoId) === String(matatu.sacco_id);
  const matatuScoped =
    [ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx?.role) &&
    userCtx?.matatuId &&
    String(userCtx.matatuId) === String(matatu.id);
  const ownerOfMatatu = matatu.created_by && userId && String(matatu.created_by) === String(userId);

  let ownerGrantScoped = false;
  if (userCtx?.role === ROLES.OWNER && !ownerOfMatatu) {
    ownerGrantScoped = await hasOwnerAccessGrant(userId, matatu.id, pool);
  }

  const staffAccess = await resolveMatatuStaffAccess(userId, matatu.id, matatu.sacco_id, pool);
  const staffGrant = [ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx?.role) && staffAccess.allowed;
  const ownerGrant = ownerOfMatatu || ownerGrantScoped;

  const allowed =
    superUser ||
    saccoScoped ||
    matatuScoped ||
    staffGrant ||
    ownerGrant;

  return {
    ok: allowed,
    role: userCtx?.role || null,
    matatu,
    membership: membershipCtx,
    reason: allowed ? 'allow' : 'MATATU_ACCESS_DENIED',
    details: {
      user_id: userId || null,
      role: userCtx?.role || null,
      requested_matatu_id: matatuId,
      sacco_id: matatu.sacco_id || null,
      ownerOfMatatu,
      ownerGrant,
      saccoScoped,
      matatuScoped,
      staffGrant,
      grantExists: staffAccess.params?.grantExists,
      assignmentExists: staffAccess.params?.assignmentExists,
      profileAssign: staffAccess.params?.profileAssign,
      allowed_sacco_ids: membershipCtx.allowed_sacco_ids || [],
      request_id: requestId || null,
    },
  };
}

module.exports = {
  normalizeRoleName,
  resolveUserContext,
  resolveMatatuStaffAccess,
  resolveMatatuAccess,
};
