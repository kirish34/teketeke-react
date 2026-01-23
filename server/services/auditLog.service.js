const { supabaseAdmin } = require('../supabase');

function safeText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function normalizeResult(value) {
  const s = String(value || 'unknown').toLowerCase();
  if (s === 'success' || s === 'ok' || s === 'accepted') return 'success';
  if (s === 'failure' || s === 'failed' || s === 'error' || s === 'rejected') return 'failure';
  return 'unknown';
}

/**
 * Write a single audit log row. Never throw — callers should not fail because
 * audit logging failed.
 */
async function auditLog({
  req = null,
  domain = 'unknown',
  resource_type = 'unknown',
  resource_id = null,
  result = 'unknown',
  message = null,
  provider_ref = null,
  internal_ref = null,
  meta = {},
  details = {},
  actor = null, // { user_id, email, role }
} = {}) {
  if (!supabaseAdmin) return { ok: false, error: 'supabaseAdmin_missing' };

  try {
    const request_id =
      safeText(req?.requestId) ||
      safeText(req?.headers?.['x-request-id']) ||
      null;

    const row = {
      domain: safeText(domain) || 'unknown',
      resource_type: safeText(resource_type) || 'unknown',
      resource_id: safeText(resource_id),
      result: normalizeResult(result),
      message: safeText(message),
      provider_ref: safeText(provider_ref),
      internal_ref: safeText(internal_ref),
      request_id,
      actor_user_id: actor?.user_id || actor?.id || null,
      actor_email: safeText(actor?.email),
      actor_role: safeText(actor?.role),
      meta: meta && typeof meta === 'object' ? meta : {},
      details: details && typeof details === 'object' ? details : {},
      // backward compatible fields for older queries
      entity_type: safeText(resource_type) || 'unknown',
      entity_id: safeText(resource_id),
    };

    const { error } = await supabaseAdmin.from('admin_audit_logs').insert(row);
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { auditLog };
