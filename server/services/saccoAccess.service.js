const pool = require('../db/pool');
const { supabaseAdmin } = require('../supabase');

function normalizeRole(role) {
  const r = String(role || '').trim().toUpperCase();
  if (!r) return null;
  if (r === 'SACCO') return 'SACCO_ADMIN';
  if (r === 'SACCO_ADMIN') return 'SACCO_ADMIN';
  if (r === 'SACCO_STAFF') return 'SACCO_STAFF';
  if (r === 'SYSTEM_ADMIN') return 'SYSTEM_ADMIN';
  if (r === 'MATATU_OWNER' || r === 'OWNER') return 'OWNER';
  if (r === 'DRIVER') return 'MATATU_STAFF';
  return r;
}

async function resolveSaccoMembership(userId, requestedSaccoId, poolArg = pool) {
  if (!userId) return { ok: false };
  const saccoIdParam = requestedSaccoId ? String(requestedSaccoId).trim() : null;
  const makeResult = (role, saccoId, source) => ({ ok: true, role, saccoId, source });

  // user_roles lookup
  const userRoleQuery = saccoIdParam
    ? `SELECT role, sacco_id FROM public.user_roles WHERE user_id = $1 AND sacco_id = $2 LIMIT 1`
    : `SELECT role, sacco_id FROM public.user_roles WHERE user_id = $1 LIMIT 1`;
  const userRoleParams = saccoIdParam ? [userId, saccoIdParam] : [userId];
  const r1 = await poolArg.query(userRoleQuery, userRoleParams).then((r) => r.rows[0] || null);
  const role1 = normalizeRole(r1?.role);
  if (role1) {
    if (role1 === 'SYSTEM_ADMIN') {
      return makeResult(role1, saccoIdParam || r1?.sacco_id || null, 'user_roles');
    }
    const saccoResolved = r1?.sacco_id || saccoIdParam || null;
    if (saccoResolved) return makeResult(role1, saccoResolved, 'user_roles');
  }

  // staff_profiles lookup
  const staffQuery = saccoIdParam
    ? `SELECT role, sacco_id FROM public.staff_profiles WHERE user_id = $1 AND sacco_id = $2 LIMIT 1`
    : `SELECT role, sacco_id FROM public.staff_profiles WHERE user_id = $1 LIMIT 1`;
  const staffParams = saccoIdParam ? [userId, saccoIdParam] : [userId];
  const r2 = await poolArg.query(staffQuery, staffParams).then((r) => r.rows[0] || null);
  const role2 = normalizeRole(r2?.role);
  if (role2) {
    if (role2 === 'SYSTEM_ADMIN') {
      return makeResult(role2, saccoIdParam || r2?.sacco_id || null, 'staff_profiles');
    }
    const saccoResolved = r2?.sacco_id || saccoIdParam || null;
    if (saccoResolved) return makeResult(role2, saccoResolved, 'staff_profiles');
  }

  // supabase fallback
  if (supabaseAdmin) {
    const { data: roleRow } = await supabaseAdmin
      .from('user_roles')
      .select('role,sacco_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (roleRow) {
      const role = normalizeRole(roleRow.role);
      if (role === 'SYSTEM_ADMIN') return makeResult(role, saccoIdParam || roleRow.sacco_id || null, 'user_roles_supabase');
      const saccoResolved = roleRow.sacco_id || saccoIdParam || null;
      if (role && saccoResolved) return makeResult(role, saccoResolved, 'user_roles_supabase');
    }

    const { data: staffRow } = await supabaseAdmin
      .from('staff_profiles')
      .select('role,sacco_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (staffRow) {
      const role = normalizeRole(staffRow.role);
      if (role === 'SYSTEM_ADMIN') return makeResult(role, saccoIdParam || staffRow.sacco_id || null, 'staff_profiles_supabase');
      const saccoResolved = staffRow.sacco_id || saccoIdParam || null;
      if (role && saccoResolved) return makeResult(role, saccoResolved, 'staff_profiles_supabase');
    }
  }

  return { ok: false };
}

function requireSaccoMembership({ allowRoles = [] } = {}) {
  const allowed = new Set(allowRoles.map(normalizeRole));
  return async (req, res, next) => {
    try {
      const requested = (req.query?.sacco_id || req.params?.sacco_id || req.saccoId || '').toString().trim();
      if (!requested) return res.status(400).json({ ok: false, error: 'sacco_id required', request_id: req.requestId || null });

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', request_id: req.requestId || null });

      const membership = await resolveSaccoMembership(userId, requested);
      const role = normalizeRole(membership.role);
      const isSystem = role === 'SYSTEM_ADMIN';
      const roleAllowed = isSystem || (role && allowed.has(role));
      const saccoMatches = !requested || !membership.saccoId || String(membership.saccoId) === requested || isSystem;

      if (membership.ok && roleAllowed && saccoMatches) {
        req.saccoId = membership.saccoId || requested;
        req.sacco_id = req.saccoId;
        req.saccoRole = role;
        return next();
      }

      if (String(process.env.DEBUG_SACCO_AUTH || '').toLowerCase() === 'true') {
        console.log('[sacco-auth] deny membership', {
          request_id: req.requestId || null,
          user_id: userId,
          role: role || null,
          requested_sacco_id: requested,
          source: membership.source || null,
        });
      }

      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'SACCO_ACCESS_DENIED',
        message: 'SACCO access denied',
        details: {
          user_id: userId,
          role: role || null,
          requested_sacco_id: requested,
          source: membership.source || null,
        },
        request_id: req.requestId || null,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'Failed to resolve sacco membership', request_id: req.requestId || null });
    }
  };
}

module.exports = {
  normalizeRole,
  resolveSaccoMembership,
  requireSaccoMembership,
};
