/**
 * Create an admin (SYSTEM_ADMIN) user in Supabase Auth and staff_profiles.
 *
 * Usage (PowerShell):
 *   $env:ADMIN_EMAIL='you@example.com'; $env:ADMIN_PASSWORD='yourPass'; node scripts/create-admin.js
 *
 * Requires in .env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

async function main() {
  const email = process.env.ADMIN_EMAIL || process.argv[2];
  const password = process.env.ADMIN_PASSWORD || process.argv[3];
  const url = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !service) {
    console.error('[create-admin] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!email || !password) {
    console.error('[create-admin] Provide ADMIN_EMAIL and ADMIN_PASSWORD (env or args)');
    process.exit(1);
  }

  const supabaseAdmin = createClient(url, service, { auth: { persistSession: false } });

  let userId = null;
  // Try to create the user
  const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    // If already exists, try to find by email via admin listUsers paging
    const msg = String(createErr.message || createErr);
    if (/already/i.test(msg) || /exists/i.test(msg) || /registered/i.test(msg)) {
      let page = 1;
      let found = null;
      while (!found) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        if (!data || !data.users || data.users.length === 0) break;
        found = data.users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
        if (found) break;
        page += 1;
        if (page > 50) break; // safety stop
      }
      if (!found) {
        throw new Error('User exists but not found via listUsers; please provide user id');
      }
      userId = found.id;
    } else {
      throw createErr;
    }
  } else {
    userId = createData.user?.id || null;
  }

  if (!userId) throw new Error('Could not determine user id');

  // Ensure staff_profiles has SYSTEM_ADMIN role for this user
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, role')
    .eq('user_id', userId)
    .limit(1);
  if (selErr) throw selErr;

  if (!existing || existing.length === 0) {
    const { error: insErr } = await supabaseAdmin.from('staff_profiles').insert([
      { user_id: userId, role: 'SYSTEM_ADMIN', name: 'System Admin', email }
    ]);
    if (insErr) throw insErr;
  } else if (existing[0].role !== 'SYSTEM_ADMIN') {
    const { error: updErr } = await supabaseAdmin
      .from('staff_profiles')
      .update({ role: 'SYSTEM_ADMIN' })
      .eq('user_id', userId);
    if (updErr) throw updErr;
  }

  console.log(JSON.stringify({ ok: true, email }));
}

main().catch((e) => {
  console.error('[create-admin] Failed:', e.message || String(e));
  process.exit(1);
});
