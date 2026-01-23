const pool =
  process.env.NODE_ENV === 'test' && global.__testPool ? global.__testPool : require('../db/pool');
const { supabaseAdmin } = require('../supabase');
const {
  normalizeEffectiveRole,
  ensureAppUserContextFromUserRoles,
  upsertAppUserContext,
} = require('./appUserContext.service');

const SACCO_ROLES = new Set(['SACCO_ADMIN', 'SACCO_STAFF', 'SYSTEM_ADMIN']);

function normalizeSaccoRole(role) {
  const raw = normalizeEffectiveRole(role);
  if (raw === 'SACCO') return 'SACCO_ADMIN';
  if (raw === 'MATATU_OWNER' || raw === 'OWNER') return 'OWNER';
  if (raw === 'DRIVER') return 'MATATU_STAFF';
  return raw;
}

// Unified resolver across app_user_context, user_roles, staff_profiles
async function getSaccoContextUnified(userId) {
  if (!userId) return { role: null, saccoId: null, source: null };
  const norm = (r) => normalizeSaccoRole(r);

  // 1) app_user_context first
  const ctxRes = await pool.query(
    `SELECT user_id, email, effective_role, sacco_id, matatu_id FROM public.app_user_context WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const ctx = ctxRes.rows[0] || null;
  const ctxRole = norm(ctx?.effective_role);
  const ctxSacco = ctx?.sacco_id || null;
  if (ctxRole && ctxSacco) {
    return { role: ctxRole, saccoId: ctxSacco, source: 'app_user_context' };
  }

  // 2) user_roles via supabaseAdmin or pool
  const loadUserRoles = async () => {
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.from('user_roles').select('role,sacco_id,matatu_id').eq('user_id', userId).maybeSingle();
      return data || null;
    }
    const res = await pool.query(
      `SELECT role, sacco_id, matatu_id FROM public.user_roles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    return res.rows[0] || null;
  };
  const r1 = await loadUserRoles();
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
    return { role: role1, saccoId: sacco1, source: 'user_roles' };
  }

  // 3) staff_profiles
  const loadStaff = async () => {
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.from('staff_profiles').select('role,sacco_id,email').eq('user_id', userId).maybeSingle();
      return data || null;
    }
    const res = await pool.query(
      `SELECT role, sacco_id, email FROM public.staff_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    return res.rows[0] || null;
  };
  const r2 = await loadStaff();
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
    return { role: role2, saccoId: sacco2, source: 'staff_profiles' };
  }

  // 4) Last resort repair
  try {
    const repaired = await ensureAppUserContextFromUserRoles(userId, ctx?.email || r2?.email || null);
    if (repaired?.effective_role && repaired?.sacco_id) {
      return {
        role: norm(repaired.effective_role),
        saccoId: repaired.sacco_id,
        source: 'repair',
      };
    }
  } catch {
    // ignore
  }

  return { role: ctxRole || role1 || role2 || null, saccoId: ctxSacco || sacco1 || sacco2 || null, source: 'none' };
}

function isSaccoAllowedRole(role) {
  return SACCO_ROLES.has(normalizeSaccoRole(role));
}

function requireSaccoAccess({ allowSystemWithoutSacco = false, allowStaff = true, allowRoles = null } = {}) {
  return async (req, res, next) => {
    try {
      const uid = req.user?.id;
      if (!uid) return res.status(401).json({ error: 'unauthorized', request_id: req.requestId || null });
      const ctx = await getSaccoContextUnified(uid);
      const allowedRoles = new Set(
        allowRoles && allowRoles.length ? allowRoles.map(normalizeSaccoRole) : ['SYSTEM_ADMIN', 'SACCO_ADMIN', ...(allowStaff ? ['SACCO_STAFF'] : [])],
      );
      if (!ctx?.role || !allowedRoles.has(ctx.role)) {
        if (String(process.env.DEBUG_SACCO_AUTH || '').toLowerCase() === 'true') {
          console.log('[sacco-auth] deny role', {
            request_id: req.requestId || null,
            user_id: uid,
            role: ctx?.role || null,
            sacco_id: ctx?.saccoId || null,
            source: ctx?.source || null,
            path: req.path,
          });
        }
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          code: 'SACCO_ACCESS_DENIED',
          message: 'SACCO access denied',
          details: {
            role: ctx?.role || null,
            user_sacco_id: ctx?.saccoId || null,
            requested_sacco_id: req.params?.saccoId || req.query?.sacco_id || null,
            source: ctx?.source || null,
          },
          request_id: req.requestId || null,
        });
      }
      if (!ctx.saccoId && !(allowSystemWithoutSacco && ctx.role === 'SYSTEM_ADMIN')) {
        if (String(process.env.DEBUG_SACCO_AUTH || '').toLowerCase() === 'true') {
          console.log('[sacco-auth] deny missing sacco', {
            request_id: req.requestId || null,
            user_id: uid,
            role: ctx.role,
            sacco_id: ctx?.saccoId || null,
            source: ctx?.source || null,
            path: req.path,
          });
        }
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          code: 'SACCO_ACCESS_DENIED',
          message: 'SACCO access denied',
          details: {
            role: ctx?.role || null,
            user_sacco_id: ctx?.saccoId || null,
            requested_sacco_id: req.params?.saccoId || req.query?.sacco_id || null,
            source: ctx?.source || null,
          },
          request_id: req.requestId || null,
        });
      }
      req.saccoId = ctx.saccoId || null;
      req.sacco_id = req.saccoId;
      req.saccoRole = ctx.role;
      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to resolve sacco access', request_id: req.requestId || null });
    }
  };
}

module.exports = {
  getSaccoContextUnified,
  // Keep old name for backwards compatibility
  getSaccoContext: getSaccoContextUnified,
  requireSaccoAccess,
  normalizeSaccoRole,
  isSaccoAllowedRole,
};
