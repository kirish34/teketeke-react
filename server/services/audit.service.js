const { supabaseAdmin } = require('../supabase');

async function logAdminAction({ req, action, resource_type = null, resource_id = null, payload = null }) {
  try {
    if (!supabaseAdmin) return;
    const actor_user_id = req?.user?.id || null;
    const actor_role =
      (req?.adminCtx?.role && String(req.adminCtx.role).toLowerCase()) ||
      (req?.user?.role && String(req.user.role).toLowerCase()) ||
      null;
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    const user_agent = req?.headers?.['user-agent'] || null;

    await supabaseAdmin.from('admin_audit_logs').insert({
      domain: 'teketeke',
      actor_user_id,
      actor_role,
      action,
      resource_type,
      resource_id,
      payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
      ip: Array.isArray(ip) ? ip.join(',') : ip || null,
      user_agent: user_agent || null,
    });
  } catch (err) {
    console.warn('[audit] log failed', err?.message || err);
  }
}

module.exports = { logAdminAction };
