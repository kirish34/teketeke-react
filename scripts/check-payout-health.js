/**
 * Payout pipeline health check.
 * - Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * - Checks payout worker monitor view for stale heartbeat or stuck processing.
 * Exits non-zero on failure.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_STALE_MIN = Number(process.env.HEALTH_MAX_STALE_MIN || 10);
const MAX_STUCK_MIN = Number(process.env.HEALTH_MAX_STUCK_MIN || 10);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[payout-health] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const { data, error } = await supa.from('payout_worker_monitor_v').select('*').maybeSingle();
  if (error || !data) {
    console.error('[payout-health] Failed to load monitor view:', error?.message || 'no data');
    process.exit(1);
  }

  const issues = [];
  const last = data.last_worker_tick_at ? new Date(data.last_worker_tick_at).getTime() : 0;
  const staleMin = last ? Math.floor((Date.now() - last) / 60000) : null;
  if (staleMin === null || staleMin > MAX_STALE_MIN) {
    issues.push(`worker heartbeat stale: ${staleMin ?? 'missing'} min`);
  }

  if (data.stuck_processing_10m !== undefined && data.stuck_processing_10m > 0) {
    if (MAX_STUCK_MIN <= 10) {
      issues.push(`stuck_processing_10m=${data.stuck_processing_10m}`);
    }
  }

  if (issues.length) {
    console.error('[payout-health] FAIL\n- ' + issues.join('\n- '));
    process.exit(1);
  }

  console.log(
    `[payout-health] OK pending=${data.pending} approved=${data.approved} processing=${data.processing} failed=${data.failed}`,
  );
}

main().catch((err) => {
  console.error('[payout-health] Fatal:', err.message);
  process.exit(1);
});
