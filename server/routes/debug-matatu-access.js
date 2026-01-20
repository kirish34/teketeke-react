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
    const matatuRes = await pool.query(`SELECT id, sacco_id, owner_user_id FROM matatus WHERE id = $1 LIMIT 1`, [
      matatuId,
    ]);
    const matatu = matatuRes.rows[0] || null;

    const ctx = await resolveSaccoAuthContext({ userId: req.user?.id });
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
      `,
      [req.user?.id, matatuId],
    );

    return res.json({
      ok: true,
      user_id: req.user?.id || null,
      role: ctx.role || null,
      active_sacco_id: ctx.saccoId || null,
      matatu,
      grants: grants.rows || [],
      assignments: assignments.rows || [],
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to debug matatu access' });
  }
});

module.exports = router;
