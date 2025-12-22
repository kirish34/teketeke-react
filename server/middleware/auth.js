const { createClient } = require('@supabase/supabase-js');
const { supabaseAnon } = require('../supabase');

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !ANON) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');

function supaForToken(token) {
  return createClient(URL, ANON, {
    auth: { persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

async function requireUser(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'invalid token' });
  req.user = data.user;
  req.supa = supaForToken(token);
  next();
}

module.exports = { requireUser, supaForToken };

