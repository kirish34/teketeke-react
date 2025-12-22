const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
if (process.env.NODE_ENV === 'production' && !service) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in production');
}

const supabaseAnon  = createClient(url, anon,    { auth: { persistSession: false }});
const supabaseAdmin = service ? createClient(url, service, { auth: { persistSession: false }}) : null;

module.exports = { supabaseAnon, supabaseAdmin };
