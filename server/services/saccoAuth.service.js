const poolDefault = require('../db/pool');
const { supabaseAdmin } = require('../supabase');

function normalizeRole(role) {
  const r = String(role || '').trim().toUpperCase();
  if (!r) return null;
  if (r === 'SACCO' || r === 'SACCO_ADMIN') return 'SACCO_ADMIN';
  if (r === 'SACCO_STAFF') return 'SACCO_STAFF';
  if (r === 'SYSTEM_ADMIN' || r === 'ADMIN') return 'SYSTEM_ADMIN';
  if (r === 'MATATU_OWNER' || r === 'OWNER') return 'MATATU_OWNER';
  if (r === 'MATATU_STAFF' || r === 'DRIVER') return 'MATATU_STAFF';
  return r;
}

async function resolveMemberships(userId, pool = poolDefault) {
  if (!userId) return { allowed_sacco_ids: [], roleRows: [], staffRows: [] };
  const roleRows = await pool
    .query(`SELECT sacco_id, role FROM public.user_roles WHERE user_id = $1`, [userId])
    .then((r) => r.rows || [])
    .catch(() => []);
  const staffRows = await pool
    .query(`SELECT sacco_id, role FROM public.staff_profiles WHERE user_id = $1`, [userId])
    .then((r) => r.rows || [])
    .catch(() => []);

  // Supabase fallback if nothing found
  if (!roleRows.length && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('user_roles')
        .select('sacco_id,role')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) roleRows.push(data);
    } catch {}
  }
  if (!staffRows.length && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('staff_profiles')
        .select('sacco_id,role')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) staffRows.push(data);
    } catch {}
  }

  const allowed = new Set();
  roleRows.forEach((r) => {
    if (r?.sacco_id) allowed.add(String(r.sacco_id));
  });
  staffRows.forEach((r) => {
    if (r?.sacco_id) allowed.add(String(r.sacco_id));
  });

  return { allowed_sacco_ids: Array.from(allowed), roleRows, staffRows };
}

async function resolveSaccoAuthContext({ userId, pool = poolDefault }) {
  const ctx = {
    user_id: userId || null,
    effective_role: null,
    active_sacco_id: null,
    allowed_sacco_ids: [],
    source: { active: 'none', membership: 'none' },
  };
  if (!userId) return ctx;

  // active sacco from app_user_context
  try {
    const res = await pool.query(
      `SELECT effective_role, sacco_id FROM public.app_user_context WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const row = res.rows[0] || null;
    if (row?.sacco_id) {
      ctx.active_sacco_id = String(row.sacco_id);
      ctx.source.active = 'app_user_context';
      ctx.effective_role = normalizeRole(row.effective_role) || ctx.effective_role;
    }
  } catch {}

  // memberships
  const membership = await resolveMemberships(userId, pool);
  ctx.allowed_sacco_ids = membership.allowed_sacco_ids;
  if (membership.roleRows.length || membership.staffRows.length) {
    ctx.source.membership = membership.roleRows.length ? 'user_roles' : 'staff_profiles';
  }
  // pick a best role (prefers admin > staff > existing)
  const roles = [...membership.roleRows, ...membership.staffRows]
    .map((r) => normalizeRole(r.role))
    .filter(Boolean);
  const pickRole = () => {
    if (roles.includes('SYSTEM_ADMIN')) return 'SYSTEM_ADMIN';
    if (roles.includes('SACCO_ADMIN')) return 'SACCO_ADMIN';
    if (roles.includes('SACCO_STAFF')) return 'SACCO_STAFF';
    return ctx.effective_role || roles[0] || null;
  };
  ctx.effective_role = pickRole();

  // If memberships are empty but active_sacco_id exists, trust it as allowed for backward compatibility
  if ((!ctx.allowed_sacco_ids || ctx.allowed_sacco_ids.length === 0) && ctx.active_sacco_id) {
    ctx.allowed_sacco_ids = [String(ctx.active_sacco_id)];
    ctx.source.membership = ctx.source.membership === 'none' ? ctx.source.active : ctx.source.membership;
  }

  return ctx;
}

function getRequestedSaccoId(req, ctx) {
  const fromQuery = (req.query?.sacco_id || '').toString().trim();
  const fromHeader = (req.headers['x-active-sacco-id'] || '').toString().trim();
  if (fromQuery) return fromQuery;
  if (fromHeader) return fromHeader;
  if (ctx?.active_sacco_id) return String(ctx.active_sacco_id);
  return null;
}

function requireSaccoMembership({ allowRoles = [], allowStaff = true } = {}) {
  const allowed = new Set(allowRoles.map(normalizeRole));
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ ok: false, error: 'unauthorized', request_id: req.requestId || null });
      }
      const ctx = await resolveSaccoAuthContext({ userId });
      const requested = getRequestedSaccoId(req, ctx);
      if (!requested) {
        return res.status(400).json({
          ok: false,
          error: 'bad_request',
          code: 'SACCO_ID_REQUIRED',
          request_id: req.requestId || null,
          details: { user_id: userId, active_sacco_id: ctx.active_sacco_id, allowed_sacco_ids: ctx.allowed_sacco_ids },
        });
      }

      const normalizedRole = normalizeRole(req.context?.effective_role || ctx.effective_role || req.user?.role);
      const isSystem = normalizedRole === 'SYSTEM_ADMIN';
      const roleAllowed =
        isSystem || (normalizedRole && allowed.has(normalizedRole)) || (allowStaff && normalizedRole === 'SACCO_STAFF');
      const saccoAllowed = isSystem || ctx.allowed_sacco_ids.includes(String(requested));

      if (roleAllowed && saccoAllowed) {
        req.saccoId = String(requested);
        req.saccoAuth = ctx;
        req.user = req.user || {};
        req.user.role = req.user.role || normalizedRole;
        return next();
      }

      if (String(process.env.DEBUG_SACCO_AUTH || '').toLowerCase() === 'true') {
        console.log('[sacco-auth] deny', {
          request_id: req.requestId || null,
          user_id: userId,
          userRole: req.user?.role,
          effectiveRole: req.context?.effective_role || ctx.effective_role || null,
          normalizedRole,
          allowedRoles: Array.from(allowed),
          requested_sacco_id: requested,
          allowed_sacco_ids: ctx.allowed_sacco_ids,
          source: ctx.source,
        });
      }

      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'SACCO_ACCESS_DENIED',
        request_id: req.requestId || null,
        details: {
          user_id: userId,
          role: normalizedRole,
          requested_sacco_id: requested,
          active_sacco_id: ctx.active_sacco_id,
          allowed_sacco_ids: ctx.allowed_sacco_ids,
          source: ctx.source,
        },
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err.message || 'Failed to resolve sacco membership',
        request_id: req.requestId || null,
      });
    }
  };
}

module.exports = {
  normalizeRole,
  resolveSaccoAuthContext,
  getRequestedSaccoId,
  requireSaccoMembership,
};
