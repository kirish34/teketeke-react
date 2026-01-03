// scripts/backfillC2BRisk.js
// Usage: node scripts/backfillC2BRisk.js --from=YYYY-MM-DD --to=YYYY-MM-DD
import dotenv from 'dotenv';
import pool from '../server/db/pool.js';
import c2bRisk from '../server/mpesa/c2bRisk.js';

const { applyRiskRules } = c2bRisk;

dotenv.config();

function parseArg(prefix, argv) {
  const hit = argv.find((item) => item.startsWith(prefix + '='));
  if (!hit) return null;
  return hit.split('=')[1] || null;
}

function toRange(dateStr) {
  if (!dateStr) return null;
  const start = new Date(`${dateStr}T00:00:00+03:00`);
  const end = new Date(`${dateStr}T23:59:59.999+03:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

async function run() {
  try {
    const argv = process.argv.slice(2);
    const fromStr = parseArg('--from', argv);
    const toStr = parseArg('--to', argv) || fromStr;
    const fromRange = toRange(fromStr);
    const toRangeValue = toRange(toStr);
    const start = fromRange ? fromRange.start : new Date(Date.now() - 24 * 3600 * 1000);
    const end = toRangeValue ? toRangeValue.end : new Date();

    const { rows } = await pool.query(
      `
        SELECT id
        FROM mpesa_c2b_payments
        WHERE created_at >= $1 AND created_at <= $2
        ORDER BY created_at ASC
      `,
      [start.toISOString(), end.toISOString()]
    );

    if (!rows.length) {
      console.log('No C2B rows found for risk backfill.');
      return;
    }

    let ok = 0;
    for (const row of rows) {
      try {
        await applyRiskRules({ paymentId: row.id });
        ok += 1;
      } catch (err) {
        console.warn(`Risk backfill failed for ${row.id}:`, err.message || err);
      }
    }
    console.log(`Risk backfill complete. Updated ${ok} rows.`);
  } catch (err) {
    console.error('Risk backfill failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
