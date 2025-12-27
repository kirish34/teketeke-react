// server/db/pool.js
// Creates a reusable Postgres connection pool for Supabase.
require('dotenv').config();
const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  throw new Error('DATABASE_URL is not set in .env');
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false, // Supabase uses SSL; allow self-signed
  },
});

module.exports = pool;
