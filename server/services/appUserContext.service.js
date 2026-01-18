const pool = require('../db/pool');

const ROLE_MAP = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  SACCO: 'SACCO_ADMIN',
  SACCO_ADMIN: 'SACCO_ADMIN',
  SACCO_STAFF: 'SACCO_STAFF',
  OWNER: 'OWNER',
  MATATU_OWNER: 'OWNER',
  DRIVER: 'DRIVER',
  MATATU_STAFF: 'MATATU_STAFF',
  STAFF: 'MATATU_STAFF',
  TAXI: 'TAXI',
  BODA: 'BODA',
};

function normalizeEffectiveRole(role) {
  const raw = String(role || '').trim().toUpperCase();
  return ROLE_MAP[raw] || raw || null;
}

async function upsertAppUserContext({ user_id, email = null, effective_role = null, sacco_id = null, matatu_id = null }) {
  if (!user_id) throw new Error('user_id is required to upsert app_user_context');
  const role = normalizeEffectiveRole(effective_role) || 'USER';
  const q = `
    INSERT INTO public.app_user_context (user_id, email, effective_role, sacco_id, matatu_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id) DO UPDATE SET
      effective_role = EXCLUDED.effective_role,
      sacco_id = EXCLUDED.sacco_id,
      matatu_id = EXCLUDED.matatu_id,
      email = COALESCE(EXCLUDED.email, app_user_context.email)
    RETURNING user_id, email, effective_role, sacco_id, matatu_id
  `;
  const res = await pool.query(q, [user_id, email, role, sacco_id, matatu_id]);
  return res.rows[0] || null;
}

async function ensureAppUserContextFromUserRoles(user_id, email = null) {
  if (!user_id) return null;
  const roleRes = await pool.query(
    `
      SELECT user_id, role, sacco_id, matatu_id
      FROM public.user_roles
      WHERE user_id = $1
      ORDER BY created_at DESC NULLS LAST, updated_at DESC NULLS LAST
      LIMIT 1
    `,
    [user_id],
  );
  const roleRow = roleRes.rows[0] || null;
  if (!roleRow) return null;
  const role = normalizeEffectiveRole(roleRow.role) || 'USER';
  return upsertAppUserContext({
    user_id,
    email,
    effective_role: role,
    sacco_id: roleRow.sacco_id || null,
    matatu_id: roleRow.matatu_id || null,
  });
}

module.exports = {
  normalizeEffectiveRole,
  upsertAppUserContext,
  ensureAppUserContextFromUserRoles,
};
