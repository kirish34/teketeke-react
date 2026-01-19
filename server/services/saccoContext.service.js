const pool = require('../db/pool');
const {
  normalizeEffectiveRole,
  ensureAppUserContextFromUserRoles,
  upsertAppUserContext,
} = require('./appUserContext.service');

const SACCO_ROLES = new Set(['SACCO_ADMIN', 'SACCO_STAFF', 'SYSTEM_ADMIN']);

function normalizeSaccoRole(role) {
  return normalizeEffectiveRole(role);
}

async function getSaccoContext(userId) {
  if (!userId) return { role: null, saccoId: null };
  const norm = (r) => normalizeSaccoRole(r);

  // 1) app_user_context
  const ctxRes = await pool.query(
    `SELECT user_id, email, effective_role, sacco_id, matatu_id FROM public.app_user_context WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const ctx = ctxRes.rows[0] || null;
  const ctxRole = norm(ctx?.effective_role);
  const ctxSacco = ctx?.sacco_id || null;
  if (ctxRole && ctxSacco) return { role: ctxRole, saccoId: ctxSacco };

  // 2) user_roles fallback
  const roleRes = await pool.query(
    `SELECT role, sacco_id, matatu_id FROM public.user_roles WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const r1 = roleRes.rows[0] || null;
  const role1 = norm(r1?.role);
  const sacco1 = r1?.sacco_id || null;
  if (role1 && sacco1) {
    await upsertAppUserContext({
      user_id: userId,
      email: ctx?.email || null,
      effective_role: role1,
      sacco_id: sacco1,
      matatu_id: r1?.matatu_id || ctx?.matatu_id || null,
    });
    return { role: role1, saccoId: sacco1 };
  }

  // 3) staff_profiles fallback
  const staffRes = await pool.query(
    `SELECT role, sacco_id, email FROM public.staff_profiles WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const r2 = staffRes.rows[0] || null;
  const role2 = norm(r2?.role);
  const sacco2 = r2?.sacco_id || null;
  if (role2 && sacco2) {
    await upsertAppUserContext({
      user_id: userId,
      email: r2?.email || ctx?.email || null,
      effective_role: role2,
      sacco_id: sacco2,
      matatu_id: ctx?.matatu_id || null,
    });
    return { role: role2, saccoId: sacco2 };
  }

  // 4) last resort: ensureAppUserContextFromUserRoles (if roles exist but no sacco)
  try {
    const repaired = await ensureAppUserContextFromUserRoles(userId, ctx?.email || r2?.email || null);
    if (repaired?.effective_role && repaired?.sacco_id) {
      return { role: norm(repaired.effective_role), saccoId: repaired.sacco_id };
    }
  } catch {
    // ignore
  }

  return { role: ctxRole || role1 || role2 || null, saccoId: ctxSacco || sacco1 || sacco2 || null };
}

function isSaccoAllowedRole(role) {
  return SACCO_ROLES.has(normalizeSaccoRole(role));
}

function requireSaccoAccess({ allowSystemWithoutSacco = false } = {}) {
  return async (req, res, next) => {
    try {
      const uid = req.user?.id;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const ctx = await getSaccoContext(uid);
      if (!ctx?.role || !isSaccoAllowedRole(ctx.role)) {
        if (String(process.env.DEBUG_SACCO_AUTH || '').toLowerCase() === 'true') {
          console.log('[sacco-auth] deny role', { user_id: uid, role: ctx?.role || null });
        }
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          code: 'SACCO_ACCESS_DENIED',
          details: { role: ctx?.role || null, user_sacco_id: ctx?.saccoId || null },
        });
      }
      if (!ctx.saccoId && !(allowSystemWithoutSacco && ctx.role === 'SYSTEM_ADMIN')) {
        if (String(process.env.DEBUG_SACCO_AUTH || '').toLowerCase() === 'true') {
          console.log('[sacco-auth] deny missing sacco', { user_id: uid, role: ctx.role, user_sacco_id: ctx?.saccoId || null });
        }
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          code: 'SACCO_ACCESS_DENIED',
          details: { role: ctx?.role || null, user_sacco_id: ctx?.saccoId || null },
        });
      }
      req.saccoId = ctx.saccoId || null;
      req.saccoRole = ctx.role;
      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to resolve sacco access' });
    }
  };
}

module.exports = {
  getSaccoContext,
  requireSaccoAccess,
  normalizeSaccoRole,
  isSaccoAllowedRole,
};
