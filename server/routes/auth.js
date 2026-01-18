const express = require('express');
const { requireUser, debugAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireUser);

async function loadUserContext(userId) {
  if (process.env.MOCK_AUTH_CONTEXT === '1') {
    return {
      user_id: userId,
      email: null,
      effective_role: 'OWNER',
      sacco_id: 'mock-sacco',
      matatu_id: 'mock-matatu',
    };
  }
  if (process.env.MOCK_AUTH_CONTEXT === 'missing') {
    return null;
  }
  const pool = require('../db/pool');
  const res = await pool.query(
    `
      SELECT user_id, email, effective_role, sacco_id, matatu_id
      FROM public.app_user_context
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );
  return res.rows[0] || null;
}

async function handleMe(req, res) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'missing user' });
  try {
    const ctx = await loadUserContext(userId);
    const fallbackRole =
      ctx?.effective_role ||
      req.user?.app_metadata?.role ||
      req.user?.user_metadata?.role ||
      'USER';
    const baseUser = {
      id: userId,
      email: req.user?.email || ctx?.email || null,
    };
    if (!ctx) {
      debugAuth({ user_id: userId, reason: 'missing_context' });
      return res.json({
        ok: true,
        user: baseUser,
        context: {
          effective_role: fallbackRole,
          sacco_id: null,
          matatu_id: null,
        },
        context_missing: true,
        needs_setup: true,
      });
    }
    debugAuth({
      user_id: userId,
      effective_role: ctx.effective_role,
      sacco_id: ctx.sacco_id,
      matatu_id: ctx.matatu_id,
    });
    return res.json({
      ok: true,
      user: baseUser,
      context: {
        effective_role: ctx.effective_role,
        sacco_id: ctx.sacco_id,
        matatu_id: ctx.matatu_id,
      },
      context_missing: false,
      needs_setup: false,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load auth context' });
  }
}

router.get('/me', handleMe);
router.get('/context', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'missing user' });
  try {
    const ctx = await loadUserContext(userId);
    return res.json({ ok: true, context: ctx || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load context' });
  }
});

router.__test = { handleMe, loadUserContext };

module.exports = router;
