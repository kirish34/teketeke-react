// server/db/pool.js
// Creates a reusable Postgres connection pool for Supabase.
require('dotenv').config();
const { Pool } = require('pg');

let dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const dbSource = process.env.DATABASE_URL
  ? 'DATABASE_URL'
  : process.env.SUPABASE_DB_URL
  ? 'SUPABASE_DB_URL'
  : null;

if (!dbUrl) {
  throw new Error('DATABASE_URL or SUPABASE_DB_URL is not set in environment');
}

let parsedUrl;
try {
  // Some providers use "postgresql://" which Node's URL parser rejects; normalize it.
  if (dbUrl.startsWith('postgresql://')) {
    dbUrl = dbUrl.replace('postgresql://', 'postgres://');
  }

  parsedUrl = new URL(dbUrl);
  console.log('[db] using host', parsedUrl.hostname || 'unknown');
} catch (err) {
  throw new Error(
    `Invalid ${dbSource || 'database URL'} format (${dbUrl}). Expected something like postgres://user:pass@host:5432/dbname. ${err.message || err}`
  );
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false, // Supabase uses SSL; allow self-signed
  },
});

module.exports = pool;
