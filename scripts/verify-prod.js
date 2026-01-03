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
  const base = process.env.BASE_URL || process.argv[2] || '';
  const email = process.env.TEST_EMAIL || process.argv[3] || '';
  const password = process.env.TEST_PASSWORD || process.argv[4] || '';
  if (!/^https?:\/\//.test(base)) throw new Error('Provide BASE_URL like https://example.com');
  if (!email || !password) throw new Error('Provide TEST_EMAIL and TEST_PASSWORD');

  // Health check
  const h = await fetch(base.replace(/\/$/,'') + '/healthz');
  const hOk = h.ok;

  // Auth token
  const token = await getToken(email, password);

  // Whoami on deployed API
  const res = await fetch(base.replace(/\/$/,'') + '/api/db/whoami', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(()=>({error:'non-json'}));
  console.log(JSON.stringify({ base, health: hOk ? h.status : h.status, whoami_status: res.status, whoami: body }));
}

main().catch(e=>{ console.error('[verify-prod] Failed:', e.message || String(e)); process.exit(1); });
