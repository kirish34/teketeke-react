import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

dotenv.config();

async function getToken(email, password) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  const supa = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) throw new Error('No access token');
  return token;
}

async function main() {
  const email = process.env.TEST_EMAIL || process.argv[2];
  const password = process.env.TEST_PASSWORD || process.argv[3];
  if (!email || !password) throw new Error('Provide TEST_EMAIL and TEST_PASSWORD');
  const token = await getToken(email, password);

  const port = process.env.PORT || 5001;
  const res = await fetch(`http://localhost:${port}/api/db/whoami`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json();
  console.log(JSON.stringify({ status: res.status, body }));
}

main().catch(e => { console.error('[verify-whoami] Failed:', e.message || String(e)); process.exit(1); });
