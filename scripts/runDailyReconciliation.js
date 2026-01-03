// scripts/runDailyReconciliation.js
// Usage: node scripts/runDailyReconciliation.js --date=YYYY-MM-DD
import dotenv from 'dotenv';
import pool from '../server/db/pool.js';
import reconService from '../server/services/reconciliation.service.js';

const { runDailyReconciliation } = reconService;

dotenv.config();

function parseDateArg(argv) {
  const arg = argv.find((item) => item.startsWith('--date='));
  if (!arg) return null;
  const value = arg.split('=')[1];
  return value || null;
}

async function run() {
  try {
    const date = parseDateArg(process.argv.slice(2));
    const result = await runDailyReconciliation({ date, client: pool });
    const paybillRow = result?.paybill_c2b;
    console.log('Reconciliation upserted:', {
      paybill_c2b: paybillRow
        ? {
            date: paybillRow.date,
            paybill_number: paybillRow.paybill_number,
            credited_total: paybillRow.credited_total,
            quarantined_total: paybillRow.quarantined_total,
            rejected_total: paybillRow.rejected_total,
          }
        : null,
      channels: result?.channels || [],
    });
  } catch (err) {
    console.error('Reconciliation failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
