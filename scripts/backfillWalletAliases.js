// scripts/backfillWalletAliases.js
// One-time helper to create wallet aliases for existing matatu wallets.
import dotenv from 'dotenv';
import pool from '../server/db/pool.js';
import walletAliases from '../server/wallet/wallet.aliases.js';

const { normalizeRef, isPlateRef, ensurePaybillAlias, ensurePlateAlias } = walletAliases;

dotenv.config();

async function run() {
  try {
    const res = await pool.query(
      `
        SELECT id, number_plate, wallet_id
        FROM matatus
        WHERE wallet_id IS NOT NULL
      `
    );

    if (!res.rows.length) {
      console.log('No matatu wallets found to backfill.');
      return;
    }

    let ok = 0;
    let skipped = 0;
    for (const row of res.rows) {
      const walletId = row.wallet_id;
      if (!walletId) {
        skipped += 1;
        continue;
      }
      try {
        const paybillAlias = await ensurePaybillAlias({ walletId, key: '11', client: pool });
        const plateRaw = row.number_plate || '';
        const plate = normalizeRef(plateRaw);
        if (plate && isPlateRef(plate)) {
          await ensurePlateAlias({ walletId, plate, client: pool });
        } else if (plateRaw) {
          console.warn(`Skipping invalid plate alias for matatu ${row.id}: ${plateRaw}`);
        }
        ok += 1;
        console.log(`OK matatu ${row.id} -> PAYBILL_CODE ${paybillAlias}`);
      } catch (err) {
        console.error(`FAIL matatu ${row.id}:`, err.message || err);
      }
    }

    console.log(`Backfill complete. Success: ${ok}, skipped: ${skipped}`);
  } catch (err) {
    console.error('Fatal error in alias backfill:', err);
  } finally {
    await pool.end();
  }
}

run();
