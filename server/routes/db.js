const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { requireUser } = require('../middleware/auth');

// GET /api/db/health -- checks env and a trivial DB query via service key
router.get('/health', async (_req, res) => {
  try {
    const env = {
      hasUrl: Boolean(process.env.SUPABASE_URL),
      hasAnon: Boolean(process.env.SUPABASE_ANON_KEY),
      hasService: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    };

    let admin = { ok: false, error: 'service_key_missing' };
    if (supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from('saccos')
        .select('id', { count: 'exact', head: true });
      admin = error ? { ok: false, error: String(error.message || error) } : { ok: true };
    }

    return res.json({ ok: env.hasUrl && env.hasAnon, env, admin });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/db/whoami -- returns current authenticated Supabase user (requires Bearer token)
router.get('/whoami', requireUser, (req, res) => {
  const u = req.user || {};
  res.json({ ok: true, user: { id: u.id || null, email: u.email || null } });
});

module.exports = router;
