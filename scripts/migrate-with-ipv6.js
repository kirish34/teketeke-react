import dotenv from 'dotenv';
import { promises as dns } from 'dns';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const urlStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!urlStr) {
    console.error('[migrate] No SUPABASE_DB_URL or DATABASE_URL in .env');
    process.exit(2);
  }
  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    console.error('[migrate] Invalid DB URL');
    process.exit(2);
  }
  const host = u.hostname;
  try {
    const ips = await dns.resolve6(host);
    if (!ips || ips.length === 0) throw new Error('no AAAA');
    u.hostname = ips[0]; // URL will format as [ipv6]
  } catch (e) {
    console.error('[migrate] Could not resolve IPv6 for host');
    process.exit(2);
  }

  const child = spawn(process.execPath, [path.join(__dirname, 'migrate.js')], {
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_DB_URL: u.toString() }
  });
  child.on('exit', (code) => process.exit(code));
}

main();
