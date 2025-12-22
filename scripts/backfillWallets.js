// scripts/backfillWallets.js
// One-time helper to create wallets for entities missing wallet_id.
require('dotenv').config();
const pool = require('../server/db/pool');
const { registerWalletForEntity } = require('../server/wallet/wallet.service');

function deriveNumericRefFromRow(row, fields) {
  for (const field of fields) {
    const val = row[field];
    if (!val) continue;
    const digits = String(val).match(/\d+/g);
    if (digits && digits.length) {
      const num = Number(digits.join('').slice(-6));
      if (num > 0) return num;
    }
  }
  return Date.now() % 100000;
}

async function backfillForTable(entityType, tableName, fields) {
  console.log(`\nBackfilling wallets for ${tableName} (${entityType})...`);
  const res = await pool.query(
    `SELECT * FROM ${tableName} WHERE wallet_id IS NULL`
  );
  if (!res.rows.length) {
    console.log(`No ${tableName} rows without wallets.`);
    return;
  }

  for (const row of res.rows) {
    const numericRef = deriveNumericRefFromRow(row, fields);
    try {
      const wallet = await registerWalletForEntity({
        entityType,
        entityId: row.id,
        numericRef,
      });
      console.log(`OK ${tableName} ${row.id} -> ${wallet.virtual_account_code}`);
    } catch (e) {
      console.error(`FAIL ${tableName} ${row.id}:`, e.message);
    }
  }
}

async function run() {
  try {
    await backfillForTable('SACCO', 'saccos', ['sacco_number', 'default_till', 'id']);
    await backfillForTable('MATATU', 'matatus', ['internal_number', 'number_plate', 'tlb_number', 'id']);
    await backfillForTable('TAXI', 'taxis', ['taxi_number', 'number_plate', 'id']);
    await backfillForTable('BODA', 'bodabodas', ['boda_number', 'number_plate', 'id']);
    console.log('\nBackfill complete.');
  } catch (err) {
    console.error('Fatal error in backfill:', err);
  } finally {
    await pool.end();
  }
}

run();
