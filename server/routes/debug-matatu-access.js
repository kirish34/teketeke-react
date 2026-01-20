const express = require('express');
const pool = require('../db/pool');
const { requireUser } = require('../middleware/auth');
const { resolveSaccoAuthContext } = require('../services/saccoAuth.service');
const router = express.Router();

router.use(requireUser);

router.get('/debug/matatu-access', async (req, res) => {
  const matatuId = (req.query.matatu_id || '').toString().trim();
  if (!matatuId) return res.status(400).json({ ok: false, error: 'matatu_id required' });
  try {
    // created_by is the owner user id for matatus
    const matatuRes = await pool.query(`SELECT id, sacco_id, created_by FROM matatus WHERE id = $1 LIMIT 1`, [
      matatuId,
    ]);
    const matatu = matatuRes.rows[0] || null;

    const ctx = await resolveSaccoAuthContext({ userId: req.user?.id });
    const roleResolved = ctx.role || null;
    const activeSaccoId = ctx.saccoId || null;
    const grants = await pool.query(
      `
        SELECT scope_type, scope_id, role, is_active
        FROM access_grants
        WHERE user_id = $1
          AND scope_id = $2
      `,
      [req.user?.id, matatuId],
    );
    const assignments = await pool.query(
      `
        SELECT sacco_id, matatu_id
        FROM matatu_staff_assignments
        WHERE staff_user_id = $1
          AND matatu_id = $2
          AND ($3::uuid IS NULL OR sacco_id = $3)
      `,
      [req.user?.id, matatuId, matatu?.sacco_id || null],
    );

    const staff_assignment_exists = (assignments.rows || []).length > 0;
    const is_owner = matatu?.created_by && req.user?.id && String(matatu.created_by) === String(req.user.id);
    const is_sacco_admin = roleResolved === 'SACCO_ADMIN' || roleResolved === 'SYSTEM_ADMIN';
    const sacco_match = matatu?.sacco_id && activeSaccoId && String(matatu.sacco_id) === String(activeSaccoId);
    const effective_access = Boolean(is_owner || (is_sacco_admin && sacco_match) || staff_assignment_exists);

    return res.json({
      ok: true,
      user_id: req.user?.id || null,
      role: roleResolved,
      role_context: ctx.role || null,
      active_sacco_id: activeSaccoId,
      matatu_id: matatu?.id || null,
      sacco_id: matatu?.sacco_id || null,
      owner_user_id: matatu?.created_by || null,
      is_owner,
      is_sacco_admin,
      staff_assignment_exists,
      effective_access,
      grants: grants.rows || [],
      assignments: assignments.rows || [],
      assignment_query_params: { user_id: req.user?.id || null, matatu_id: matatuId, sacco_id: matatu?.sacco_id || null },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to debug matatu access' });
  }
});

module.exports = router;
