const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin } = require('../supabase');

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !ANON) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for auth verification');

function supaForToken(token) {
  return createClient(URL, ANON, {
    auth: { persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function debugAuth(payload) {
  if (String(process.env.DEBUG_AUTH || '').trim() !== '1') return;
  try {
    console.log('[auth]', payload);
  } catch {
    // ignore logging errors
  }
}

async function requireUser(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    debugAuth({ header: Boolean(auth), token_length: 0, reason: 'missing_token' });
    return res.status(401).json({ error: 'missing token' });
  }
  if (process.env.MOCK_SUPABASE_AUTH === 'fail') {
    return res.status(401).json({ error: 'invalid token' });
  }
  if (process.env.MOCK_SUPABASE_AUTH === '1') {
    req.user = { id: 'mock-user', email: null };
    req.supa = supaForToken(token);
    debugAuth({ token_length: token.length, user_id: req.user.id, mock: true });
    return next();
  }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      debugAuth({ token_length: token.length, reason: 'invalid_token', error: error?.message });
      return res.status(401).json({ error: 'invalid token' });
    }
    req.user = data.user;
    req.supa = supaForToken(token);
    debugAuth({ token_length: token.length, user_id: data.user.id });
    return next();
  } catch (err) {
    debugAuth({ token_length: token.length, reason: 'auth_exception', error: err?.message });
    // Treat unexpected Supabase errors as 401 to avoid frontend logout loops on 403.
    return res.status(401).json({ error: 'invalid token' });
  }
}

module.exports = { requireUser, supaForToken, debugAuth };

