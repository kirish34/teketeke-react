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
  if (!userId) return { role: null, saccoId: null, matatuId: null, source: null };
  const norm = (r) => normalizeSaccoRole(r);

  // 1) app_user_context first
  const ctxRes = await pool.query(
    `SELECT user_id, email, effective_role, sacco_id, matatu_id FROM public.app_user_context WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const ctx = ctxRes.rows[0] || null;
  const ctxRole = norm(ctx?.effective_role);
  const ctxSacco = ctx?.sacco_id || null;
  const ctxMatatu = ctx?.matatu_id || null;
  if (ctxRole && ctxSacco) {
    return { role: ctxRole, saccoId: ctxSacco, matatuId: ctxMatatu, source: 'app_user_context' };
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
    return { role: role1, saccoId: sacco1, matatuId: r1?.matatu_id || ctxMatatu || null, source: 'user_roles' };
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
    return { role: role2, saccoId: sacco2, matatuId: ctxMatatu || null, source: 'staff_profiles' };
  }

  // 4) Last resort repair
  try {
    const repaired = await ensureAppUserContextFromUserRoles(userId, ctx?.email || r2?.email || null);
  if (repaired?.effective_role && repaired?.sacco_id) {
    return {
      role: norm(repaired.effective_role),
      saccoId: repaired.sacco_id,
      matatuId: repaired.matatu_id || ctxMatatu || null,
      source: 'repair',
    };
  }
  } catch {
    // ignore
  }

  return {
    role: ctxRole || role1 || role2 || null,
    saccoId: ctxSacco || sacco1 || sacco2 || null,
    matatuId: ctxMatatu || r1?.matatu_id || null,
    source: 'none',
  };
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
        allowRoles && allowRoles.length
          ? allowRoles.map(normalizeSaccoRole)
          : ['SYSTEM_ADMIN', 'SACCO_ADMIN', ...(allowStaff ? ['SACCO_STAFF', 'MATATU_STAFF'] : [])],
      );
      if (!ctx?.role || !allowedRoles.has(ctx.role)) {
        if (String(process.env.DEBUG_SACCO_AUTH || '').toLowerCase() === 'true') {
          console.log('[sacco-auth] deny role', {
            request_id: req.requestId || null,
            user_id: uid,
            role: ctx?.role || null,
            sacco_id: ctx?.saccoId || null,
            matatu_id: ctx?.matatuId || null,
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
            user_matatu_id: ctx?.matatuId || null,
            source: ctx?.source || null,
          },
          request_id: req.requestId || null,
        });
      }
      // Fallback: if matatu_id is present but sacco_id missing, derive sacco from matatu row for matatu_staff
      if (!ctx.saccoId && ctx.role === 'MATATU_STAFF') {
        const matatuIdParam =
          (req.params && (req.params.matatu_id || req.params.matatuId)) ||
          (req.query && (req.query.matatu_id || req.query.matatuId)) ||
          (req.body && (req.body.matatu_id || req.body.matatuId)) ||
          null;
        if (matatuIdParam) {
          try {
            const matatuRes = await pool.query(`SELECT sacco_id FROM matatus WHERE id = $1 LIMIT 1`, [matatuIdParam]);
            const matRow = matatuRes.rows[0] || null;
            if (matRow?.sacco_id) {
              ctx.saccoId = matRow.sacco_id;
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (!ctx.saccoId && !(allowSystemWithoutSacco && ctx.role === 'SYSTEM_ADMIN')) {
        if (String(process.env.DEBUG_SACCO_AUTH || '').toLowerCase() === 'true') {
          console.log('[sacco-auth] deny missing sacco', {
            request_id: req.requestId || null,
            user_id: uid,
            role: ctx.role,
            sacco_id: ctx?.saccoId || null,
            matatu_id: ctx?.matatuId || null,
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
            user_matatu_id: ctx?.matatuId || null,
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
