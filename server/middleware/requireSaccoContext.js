const { getSaccoContextUnified } = require('../services/saccoContext.service');

/**
 * Resolve SACCO context once per request.
 * Order of precedence:
 *   1) query param sacco_id
 *   2) headers x-sacco-id or x-active-sacco-id
 *   3) resolved context from DB (app_user_context/user_roles)
 */
function requireSaccoContext() {
  return async (req, res, next) => {
    try {
      const fromQuery = String(req.query?.sacco_id || '').trim();
      const fromHeader =
        String(req.headers['x-sacco-id'] || '').trim() ||
        String(req.headers['x-active-sacco-id'] || '').trim();

      let saccoId = fromQuery || fromHeader || null;

      if (!saccoId && req.user?.id) {
        const ctx = await getSaccoContextUnified(req.user.id);
        saccoId = ctx?.saccoId || ctx?.sacco_id || null;
      }

      if (!saccoId) {
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          code: 'SACCO_CONTEXT_REQUIRED',
          message: 'Select a SACCO to continue',
          request_id: req.requestId || null,
        });
      }

      req.sacco_id = saccoId;
      req.saccoId = saccoId; // preserve legacy camelCase usage
      return next();
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: 'SACCO_CONTEXT_ERROR',
        message: err?.message || 'Failed to resolve SACCO context',
        request_id: req.requestId || null,
      });
    }
  };
}

module.exports = requireSaccoContext;
