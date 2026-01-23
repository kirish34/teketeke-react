const express = require('express');
const { requireUser, debugAuth } = require('../middleware/auth');
const {
  upsertAppUserContext,
  ensureAppUserContextFromUserRoles,
  normalizeEffectiveRole,
} = require('../services/appUserContext.service');

const router = express.Router();

router.use(requireUser);

function getPool() {
  if (process.env.NODE_ENV === 'test' && global.__testPool) {
    return global.__testPool;
  }
  // Lazy require to keep tests fast and allow mocking.
  // eslint-disable-next-line global-require
  return require('../db/pool');
}

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
  const pool = getPool();
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

async function ensureUserContext(userId, email, fallbackRole) {
  return upsertAppUserContext({
    user_id: userId,
    email: email || null,
    effective_role: normalizeEffectiveRole(fallbackRole),
    sacco_id: null,
    matatu_id: null,
  });
}

async function handleMe(req, res) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'missing user' });
  try {
    const mockMissing = process.env.MOCK_AUTH_CONTEXT === 'missing';
    let ctx = await loadUserContext(userId);
    const fallbackRole = normalizeEffectiveRole(
      ctx?.effective_role ||
        req.user?.app_metadata?.role ||
        req.user?.user_metadata?.role ||
        'USER',
    );
    const baseUser = {
      id: userId,
      email: req.user?.email || ctx?.email || null,
      role: null,
    };

    if (mockMissing) {
      return res.json({
        ok: true,
        user: baseUser,
        context: { effective_role: null, sacco_id: null, matatu_id: null },
        context_missing: true,
        needs_setup: true,
      });
    }

    if (!ctx) {
      try {
        const repaired = await ensureAppUserContextFromUserRoles(userId, baseUser.email);
        ctx = repaired || null;
      } catch (err) {
        debugAuth({ user_id: userId, reason: 'context_repair_failed', error: err?.message });
      }
    }
    if (!ctx) {
      debugAuth({ user_id: userId, reason: 'missing_context' });
      let created = null;
      try {
        created = await ensureUserContext(userId, baseUser.email, fallbackRole || 'USER');
      } catch (err) {
        debugAuth({ user_id: userId, reason: 'ensure_context_failed', error: err?.message });
      }
      return res.json({
        ok: true,
        user: baseUser,
        context: {
          effective_role: created ? normalizeEffectiveRole(created?.effective_role) : null,
          sacco_id: created?.sacco_id || null,
          matatu_id: created?.matatu_id || null,
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
    const mappedCtx = {
      effective_role: normalizeEffectiveRole(ctx.effective_role),
      sacco_id: ctx.sacco_id,
      matatu_id: ctx.matatu_id,
    };
    baseUser.role = mappedCtx.effective_role ? String(mappedCtx.effective_role).toLowerCase() : req.user?.role || null;
    req.context = mappedCtx;
    req.user.role = baseUser.role;
    return res.json({
      ok: true,
      user: baseUser,
      context: mappedCtx,
      context_missing: false,
      needs_setup: false,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load auth context' });
  }
}

router.get('/me', handleMe);

// Authenticated whoami with memberships list
router.get('/whoami', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ ok: false, error: 'missing user' });
  const pool = getPool();
  try {
    const ctx = await loadUserContext(userId);
    const memberships = [];
    const mapRows = (rows, source) =>
      (rows || []).forEach((row) => {
        if (!row) return;
        memberships.push({
          sacco_id: row.sacco_id || null,
          role: normalizeEffectiveRole(row.role),
          source,
        });
      });
    const { rows: roleRows } = await pool.query(
      `SELECT sacco_id, role FROM public.user_roles WHERE user_id = $1`,
      [userId],
    );
    mapRows(roleRows, 'user_roles');
    const { rows: staffRows } = await pool.query(
      `SELECT sacco_id, role FROM public.staff_profiles WHERE user_id = $1`,
      [userId],
    );
    mapRows(staffRows, 'staff_profiles');

    res.json({
      ok: true,
      user: { id: userId, email: req.user?.email || ctx?.email || null },
      context: {
        effective_role: ctx?.effective_role || null,
        sacco_id: ctx?.sacco_id || null,
        matatu_id: ctx?.matatu_id || null,
      },
      memberships: { saccos: memberships },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to load whoami' });
  }
});
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

router.__test = { handleMe, loadUserContext, ensureUserContext };

module.exports = router;
