const { supabaseAdmin } = require('../supabase');

async function logAdminAction({
  req,
  action,
  resource_type = null,
  resource_id = null,
  payload = null,
  result = null,
  error_code = null,
}) {
  try {
    if (!supabaseAdmin) return;
    const user_id = req?.user?.id || null;
    const actor_role =
      (req?.adminCtx?.role && String(req.adminCtx.role).toLowerCase()) ||
      (req?.user?.role && String(req.user.role).toLowerCase()) ||
      null;
    const ip_address = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    const user_agent = req?.headers?.['user-agent'] || null;
    const request_id = req?.requestId || req?.headers?.['x-request-id'] || null;

    const meta = payload ? JSON.parse(JSON.stringify(payload)) : {};
    if (actor_role) meta.actor_role = actor_role;

    await supabaseAdmin.from('admin_audit_logs').insert({
      domain: 'teketeke',
      user_id,
      action,
      entity_type: resource_type,
      entity_id: resource_id,
      path: req?.path || null,
      meta,
      ip_address: Array.isArray(ip_address) ? ip_address.join(',') : ip_address || null,
      user_agent: user_agent || null,
      request_id,
      result: result || null,
      error_code: error_code || null,
    });
  } catch (err) {
    console.warn('[audit] log failed', err?.message || err);
  }
}

module.exports = { logAdminAction };
