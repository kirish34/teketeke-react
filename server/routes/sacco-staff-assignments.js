const express = require('express');
const pool = require('../db/pool');
const { requireUser } = require('../middleware/auth');
const { requireSaccoMembership } = require('../services/saccoAuth.service');

const router = express.Router();

router.use(requireUser);
router.use(requireSaccoMembership({ allowRoles: ['SACCO_ADMIN', 'SYSTEM_ADMIN'], allowStaffRoles: [] }));

// GET /api/sacco/staff-assignments?staff_user_id=<uuid>
router.get('/staff-assignments', async (req, res) => {
  const staffUserId = (req.query.staff_user_id || '').toString().trim();
  if (!staffUserId) {
    return res.status(400).json({ ok: false, error: 'staff_user_id required' });
  }
  try {
    const { rows } = await pool.query(
      `
        SELECT staff_user_id, matatu_id, sacco_id, created_at
        FROM matatu_staff_assignments
        WHERE staff_user_id = $1
          AND sacco_id = $2
        ORDER BY created_at DESC
      `,
      [staffUserId, req.saccoId],
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load assignments' });
  }
});

// POST /api/sacco/staff-assignments { staff_user_id, matatu_id }
router.post('/staff-assignments', async (req, res) => {
  const staffUserId = (req.body?.staff_user_id || '').toString().trim();
  const matatuId = (req.body?.matatu_id || '').toString().trim();
  if (!staffUserId || !matatuId) {
    return res.status(400).json({ ok: false, error: 'staff_user_id and matatu_id required' });
  }
  try {
    // ensure matatu belongs to this sacco
    const { rows: mats } = await pool.query(`SELECT id FROM matatus WHERE id = $1 AND sacco_id = $2 LIMIT 1`, [
      matatuId,
      req.saccoId,
    ]);
    if (!mats.length) return res.status(403).json({ ok: false, error: 'matatu not in this sacco' });

    await pool.query(
      `
        INSERT INTO matatu_staff_assignments (sacco_id, staff_user_id, matatu_id)
        VALUES ($1,$2,$3)
        ON CONFLICT (staff_user_id, matatu_id) DO NOTHING
      `,
      [req.saccoId, staffUserId, matatuId],
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to save assignment' });
  }
});

// DELETE /api/sacco/staff-assignments { staff_user_id, matatu_id }
router.delete('/staff-assignments', async (req, res) => {
  const staffUserId = (req.body?.staff_user_id || '').toString().trim();
  const matatuId = (req.body?.matatu_id || '').toString().trim();
  if (!staffUserId || !matatuId) {
    return res.status(400).json({ ok: false, error: 'staff_user_id and matatu_id required' });
  }
  try {
    await pool.query(
      `
        DELETE FROM matatu_staff_assignments
        WHERE staff_user_id = $1
          AND matatu_id = $2
          AND sacco_id = $3
      `,
      [staffUserId, matatuId, req.saccoId],
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to remove assignment' });
  }
});

module.exports = router;
