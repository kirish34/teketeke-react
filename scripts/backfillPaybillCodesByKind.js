// scripts/backfillPaybillCodesByKind.js
// Ensure PAYBILL_CODE aliases exist based on wallet_kind mapping.
import dotenv from 'dotenv';
import pool from '../server/db/pool.js';
import walletAliases from '../server/wallet/wallet.aliases.js';

dotenv.config();

const { ensurePaybillAlias } = walletAliases;

const KIND_TO_KEY = {
  SACCO_DAILY_FEE: '30',
  SACCO_LOAN: '31',
  SACCO_SAVINGS: '32',
  MATATU_OWNER: '10',
  MATATU_VEHICLE: '11',
  TAXI_DRIVER: '40',
  BODA_RIDER: '50',
};

function inferWalletKind(row) {
  if (row.wallet_kind) return row.wallet_kind;
  const type = String(row.entity_type || '').toUpperCase();
  if (type === 'SACCO') return 'SACCO_DAILY_FEE';
  if (type === 'MATATU') return 'MATATU_VEHICLE';
  if (type === 'TAXI') return 'TAXI_DRIVER';
  if (type === 'BODA' || type === 'BODABODA') return 'BODA_RIDER';
  return null;
}

async function run() {
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const { rows } = await pool.query(
      `
        SELECT w.id, w.wallet_kind, w.entity_type
        FROM wallets w
        LEFT JOIN wallet_aliases wa
          ON wa.wallet_id = w.id AND wa.alias_type = 'PAYBILL_CODE'
        WHERE wa.id IS NULL
        ORDER BY w.created_at ASC
      `
    );

    if (!rows.length) {
      console.log('No wallets missing PAYBILL_CODE aliases.');
      return;
    }

    for (const row of rows) {
      const inferredKind = inferWalletKind(row);
      const key = inferredKind ? KIND_TO_KEY[inferredKind] : null;
      if (!key) {
        skipped += 1;
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (!row.wallet_kind && inferredKind) {
          await client.query(`UPDATE wallets SET wallet_kind = $1 WHERE id = $2`, [inferredKind, row.id]);
        }
        const code = await ensurePaybillAlias({ walletId: row.id, key, client });
        await client.query('COMMIT');
        ok += 1;
        console.log(`OK wallet ${row.id} (${inferredKind}) -> ${code}`);
      } catch (err) {
        await client.query('ROLLBACK');
        failed += 1;
        console.warn(`FAIL wallet ${row.id}:`, err.message || err);
      } finally {
        client.release();
      }
    }
  } catch (err) {
    console.error('Backfill failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }

  console.log(`Backfill complete. Success: ${ok}, skipped: ${skipped}, failed: ${failed}`);
}

run();
