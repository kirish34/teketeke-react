const { createClient } = require('@supabase/supabase-js');

const url = (process.env.SUPABASE_URL || '').trim();
const anon = (process.env.SUPABASE_ANON_KEY || '').trim();
const service = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const isTest = process.env.NODE_ENV === 'test';

if (!url || !anon) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
if (process.env.NODE_ENV === 'production' && !service) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in production');
}

// Helpful diagnostics to spot empty/invalid keys without leaking the secret.
try {
  console.log('[supabase] url set:', !!url);
  console.log('[supabase] anon len:', anon.length, 'prefix:', anon.slice(0, 6));
  console.log('[supabase] service len:', service.length, 'prefix:', service.slice(0, 6));
} catch {
  // ignore log errors
}

const supabaseAnon = createClient(url, anon, { auth: { persistSession: false, detectSessionInUrl: false } });
function createMockSupabaseAdmin() {
  const defaultResult = { data: [], error: null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: async () => defaultResult,
    update: async () => defaultResult,
    maybeSingle: async () => defaultResult,
    single: async () => defaultResult,
  };
  return {
    from: () => builder,
    rpc: async () => defaultResult,
    auth: {
      getUser: async () => ({ data: { user: { id: 'mock-user' } }, error: null }),
      admin: {},
    },
  };
}

const useMockAdmin = isTest && String(process.env.MOCK_SUPABASE_ADMIN || '1') !== '0';
const supabaseAdmin = service && !useMockAdmin
  ? createClient(url, service, { auth: { persistSession: false, detectSessionInUrl: false } })
  : useMockAdmin
    ? createMockSupabaseAdmin()
    : null;

module.exports = { supabaseAnon, supabaseAdmin };
