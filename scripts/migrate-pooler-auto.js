require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');

function runWithUrl(url) {
  const env = { ...process.env, SUPABASE_DB_URL: url, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
  const res = spawnSync(process.execPath, [path.join(__dirname, 'migrate.js')], { stdio: 'inherit', env });
  return res.status ?? 1;
}

const urlStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!urlStr) {
  console.error('[migrate] No DB URL in environment');
  process.exit(2);
}

let u;
try {
  u = new URL(urlStr);
} catch (e) {
  console.error('[migrate] Invalid DB URL');
  process.exit(2);
}

const hostBase = 'aws-0-eu-north-1.pooler.supabase.com';
const project = 'ecjkxgegjzvixyuukysk';
const pass = u.password;

// Try Session first (6543 + user with project suffix)
const sessionUrl = `postgresql://postgres.${project}:${encodeURIComponent(pass)}@${hostBase}:6543/postgres?sslmode=require`;
let code = runWithUrl(sessionUrl);
if (code === 0) process.exit(0);

// Fallback: Transaction pooler (5432 + user without suffix)
const txUrl = `postgresql://postgres:${encodeURIComponent(pass)}@${hostBase}:5432/postgres?sslmode=require`;
code = runWithUrl(txUrl);
process.exit(code);

