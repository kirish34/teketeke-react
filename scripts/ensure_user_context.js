/**
 * Ensure every Supabase auth user has at least a USER role row.
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/ensure_user_context.js
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const url = process.env.SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !service) {
  console.error('[ensure_user_context] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, service, { auth: { persistSession: false } });

async function ensureUserRole(userId) {
  const { data: roles, error } = await supabase.from('user_roles').select('user_id').eq('user_id', userId).limit(1);
  if (error) throw error;
  if (roles && roles.length > 0) return false;
  const { error: upsertError } = await supabase.from('user_roles').upsert(
    { user_id: userId, role: 'USER', sacco_id: null, matatu_id: null },
    { onConflict: 'user_id' },
  );
  if (upsertError) throw upsertError;
  return true;
}

async function main() {
  let created = 0;
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (!data?.users?.length) break;
    for (const user of data.users) {
      const added = await ensureUserRole(user.id);
      if (added) created += 1;
    }
    page += 1;
  }
  console.log(`[ensure_user_context] Added USER role for ${created} users without context`);
}

main().catch((err) => {
  console.error('[ensure_user_context] Failed:', err.message || err);
  process.exit(1);
});
