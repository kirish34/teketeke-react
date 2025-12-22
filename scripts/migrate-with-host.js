// Load .env and override DB host for this one run
require('dotenv').config();

const { spawn } = require('child_process');

const NEW_HOST = 'db.apbkobhfnmcqqzqeeqss.supabase.co';
const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] No SUPABASE_DB_URL or DATABASE_URL in .env');
  process.exit(2);
}

const updated = url.replace(/db\.[^.]+\.supabase\.co/, NEW_HOST);

// Run the normal migration script with the overridden env var
const child = spawn(process.execPath, [require('path').join(__dirname, 'migrate.js')], {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_DB_URL: updated }
});

child.on('exit', (code) => process.exit(code));

