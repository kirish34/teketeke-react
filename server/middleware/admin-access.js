const { supaForToken } = require('./auth');
const { supabaseAnon } = require('../supabase');

/**
 * Allows access if:
 * - ADMIN_TOKEN matches X-Admin-Token or Bearer token
 * - Or Supabase bearer token is valid (System Admins can be enforced upstream)
 */
async function requireAdminAccess(req, res, next) {
  const secret = process.env.ADMIN_TOKEN || '';
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const headerToken = req.headers['x-admin-token'] || bearer || '';

  if (secret) {
    if (headerToken === secret) return next();
  }

  if (!headerToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { data, error } = await supabaseAnon.auth.getUser(headerToken);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.user = data.user;
    req.supa = supaForToken(headerToken);
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

module.exports = { requireAdminAccess };
