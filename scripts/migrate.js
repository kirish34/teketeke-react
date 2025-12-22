/**
 * Simple SQL migration runner for Supabase/Postgres.
 *
 * Usage:
 *  - Set SUPABASE_DB_URL (or DATABASE_URL) in .env
 *  - npm install
 *  - npm run migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('[migrate] Missing SUPABASE_DB_URL (or DATABASE_URL) in environment');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

async function ensureTable(client) {
  await client.query(`
    create table if not exists public.schema_migrations (
      id serial primary key,
      name text unique not null,
      applied_at timestamptz not null default now()
    );
  `);
}

async function isApplied(client, name) {
  const { rows } = await client.query('select 1 from public.schema_migrations where name = $1 limit 1', [name]);
  return rows.length > 0;
}

async function applyMigration(client, name, sql) {
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into public.schema_migrations(name) values($1) on conflict(name) do nothing', [name]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

async function main() {
  console.log('[migrate] Connecting...');
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await ensureTable(client);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    if (files.length === 0) {
      console.log('[migrate] No .sql files found in supabase/migrations');
      return;
    }

    for (const file of files) {
      const p = path.join(MIGRATIONS_DIR, file);
      const applied = await isApplied(client, file);
      if (applied) {
        console.log(`- Skipping ${file} (already applied)`);
        continue;
      }
      console.log(`- Applying ${file}...`);
      const sql = fs.readFileSync(p, 'utf8');
      await applyMigration(client, file, sql);
      console.log(`  Applied ${file}`);
    }

    console.log('[migrate] All migrations applied');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});

