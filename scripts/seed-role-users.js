/**
 * Seed demo users for the multi-role mobile dashboards.
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_URL='...'
 *   $env:SUPABASE_SERVICE_ROLE_KEY='...'
 *   node scripts/seed-role-users.js
 *
 * The script will create (or reuse) Supabase Auth users for each role,
 * then upsert rows into public.user_roles so the mobile dashboards
 * show data scoped to seeded sacco/matatu entries.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[seed-role-users] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const PASSWORD = process.env.DEMO_USER_PASSWORD || 'TekePass123!';

const ROLE_CONFIGS = [
  {
    role: 'SACCO',
    email: 'sacco.manager@example.com',
    saccoName: 'CityRiders',
  },
  {
    role: 'SACCO_STAFF',
    email: 'sacco.staff@example.com',
    saccoName: 'CityRiders',
  },
  {
    role: 'OWNER',
    email: 'owner.city@example.com',
    matatuPlate: 'KDA123A',
  },
  {
    role: 'STAFF',
    email: 'crew.city@example.com',
    matatuPlate: 'KDA123A',
  },
  {
    role: 'TAXI',
    email: 'taxi.driver@example.com',
    vehicleType: 'TAXI',
  },
  {
    role: 'BODA',
    email: 'boda.rider@example.com',
    vehicleType: 'BODABODA',
  },
];

async function ensureUser(supabaseAdmin, email) {
  const createRes = await supabaseAdmin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (createRes.error) {
    const msg = String(createRes.error.message || createRes.error);
    if (!/already/i.test(msg) && !/exists/i.test(msg) && !/registered/i.test(msg)) {
      throw createRes.error;
    }

    let page = 1;
    while (page <= 50) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      if (!data?.users?.length) break;
      const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
      if (found) return found.id;
      page += 1;
    }
    throw new Error(`User ${email} exists but could not be fetched via listUsers`);
  }

  return createRes.data.user?.id;
}

async function resolveSaccoId(client, config) {
  if (!config.saccoName) return null;
  const { data, error } = await client
    .from('saccos')
    .select('id')
    .ilike('name', config.saccoName)
    .limit(1);
  if (error) throw error;
  if (!data?.length) throw new Error(`Sacco "${config.saccoName}" not found`);
  return data[0].id;
}

async function resolveMatatuId(client, config) {
  if (config.matatuPlate) {
    const { data, error } = await client
      .from('matatus')
      .select('id')
      .ilike('number_plate', config.matatuPlate)
      .limit(1);
    if (error) throw error;
    if (!data?.length) throw new Error(`Matatu with plate "${config.matatuPlate}" not found`);
    return data[0].id;
  }
  if (config.vehicleType) {
    const { data, error } = await client
      .from('matatus')
      .select('id')
      .ilike('vehicle_type', config.vehicleType)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data?.length) {
      throw new Error(`No matatu found with vehicle_type "${config.vehicleType}"`);
    }
    return data[0].id;
  }
  return null;
}

async function upsertRole(client, config, userId, saccoId, matatuId) {
  const payload = {
    user_id: userId,
    role: config.role,
    sacco_id: saccoId,
    matatu_id: matatuId,
  };

  const { error } = await client
    .from('user_roles')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}

async function main() {
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const created = [];

  for (const config of ROLE_CONFIGS) {
    console.log(`\n[seed-role-users] Processing ${config.role} (${config.email})`);
    const userId = await ensureUser(supabaseAdmin, config.email);
    if (!userId) throw new Error(`Failed to resolve user id for ${config.email}`);

    const saccoId = await resolveSaccoId(supabaseAdmin, config);
    const matatuId = await resolveMatatuId(supabaseAdmin, config);

    await upsertRole(supabaseAdmin, config, userId, saccoId, matatuId);

    created.push({
      role: config.role,
      email: config.email,
      password: PASSWORD,
      sacco_id: saccoId,
      matatu_id: matatuId,
    });
  }

  console.table(created);
  console.log('\nAll demo users are seeded. Use the above credentials to sign in.');
}

main().catch((err) => {
  console.error('[seed-role-users] Failed:', err.message || err);
  process.exit(1);
});
