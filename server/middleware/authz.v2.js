const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const { supabaseAdmin } = require('../supabase');

function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}

async function fetchAppUserContext(userId) {
  if (!userId) return null;
  try {
    const res = await pool.query(
      `
        SELECT user_id, email, effective_role, sacco_id, matatu_id
        FROM public.app_user_context
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId],
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[authz.v2] failed to load app_user_context', err.message);
    return null;
  }
}

function buildRequestId(req, res) {
  const incoming = (req.headers['x-request-id'] || req.headers['request-id'] || '').toString().trim();
  const id = incoming || randomUUID();
  req.requestId = id;
  res.set('x-request-id', id);
  return id;
}

async function requireUserV2(req, res, next) {
  buildRequestId(req, res);
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, error: 'missing token', request_id: req.requestId });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ ok: false, error: 'supabase admin not configured', request_id: req.requestId });
  }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ ok: false, error: 'invalid token', request_id: req.requestId });
    }
    req.user = data.user;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: err.message || 'invalid token', request_id: req.requestId });
  }
}

function requireSaccoRoleV2(allowRoles = []) {
  const allowed = new Set(allowRoles.map(normalizeRole));
  return async (req, res, next) => {
    try {
      const ctx = await fetchAppUserContext(req.user?.id);
      req.context = {
        effective_role: ctx?.effective_role || null,
        sacco_id: ctx?.sacco_id || null,
        matatu_id: ctx?.matatu_id || null,
      };
      const normalizedRole = normalizeRole(req.context.effective_role);
      const requestedSaccoId =
        (req.query?.sacco_id || '').toString().trim() ||
        (req.headers['x-active-sacco-id'] || '').toString().trim() ||
        (ctx?.sacco_id ? String(ctx.sacco_id) : '');

      if (!requestedSaccoId) {
        return res.status(400).json({
          ok: false,
          error: 'bad_request',
          code: 'SACCO_ID_REQUIRED',
          request_id: req.requestId,
          details: { user_id: req.user?.id || null },
        });
      }

      const roleAllowed = normalizedRole === 'SYSTEM_ADMIN' || allowed.has(normalizedRole);
      if (!roleAllowed) {
        if (String(process.env.DEBUG_WALLET_AUTH || '').toLowerCase() === 'true') {
          console.log('[authz.v2] deny', {
            request_id: req.requestId,
            userId: req.user?.id || null,
            userRole: req.user?.role || null,
            effectiveRole: req.context?.effective_role || null,
            normalizedRole,
            allowedRoles: Array.from(allowed),
            saccoId: requestedSaccoId,
            path: req.originalUrl,
          });
        }
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          code: 'SACCO_ACCESS_DENIED',
          request_id: req.requestId,
          details: {
            user_id: req.user?.id || null,
            role: normalizedRole || null,
            requested_sacco_id: requestedSaccoId,
            active_sacco_id: req.context?.sacco_id || null,
          },
        });
      }

      req.saccoId = requestedSaccoId;
      return next();
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err.message || 'authz_failed',
        request_id: req.requestId,
      });
    }
  };
}

module.exports = {
  normalizeRole,
  requireUserV2,
  requireSaccoRoleV2,
};
