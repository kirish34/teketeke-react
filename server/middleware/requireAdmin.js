const { requireUser } = require('./auth');
const { getSaccoContext } = require('../services/saccoContext.service');
const { supabaseAdmin } = require('../supabase');

function buildGuard(allowedRoles = []) {
  return async (req, res, next) => {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
    }
    return requireUser(req, res, async () => {
      try {
        const ctx = await getSaccoContext(req.user?.id);
        const role = String(ctx?.role || '').toLowerCase();
        const allowed = new Set(allowedRoles.map((r) => String(r || '').toLowerCase()));
        if (!allowed.has(role)) {
          return res.status(403).json({
            error: 'forbidden',
            role,
            required: Array.from(allowed),
          });
        }
        req.adminCtx = { ...ctx, role };
        return next();
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    });
  };
}

const requireSystemOrSuper = buildGuard(['system_admin', 'super_admin']);
const requireSuperOnly = buildGuard(['super_admin']);

module.exports = { requireSystemOrSuper, requireSuperOnly };
