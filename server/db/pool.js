// server/db/pool.js
// Creates a reusable Postgres connection pool for Supabase.
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.SUPABASE_DB_URL) {
  throw new Error('SUPABASE_DB_URL is not set in .env');
}

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: {
    rejectUnauthorized: false, // Supabase uses SSL; allow self-signed
  },
});

module.exports = pool;
