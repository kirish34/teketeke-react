/* eslint-disable no-console */
require('dotenv').config();
const pool = require('../server/db/pool');

async function getCreditedPayments() {
  const { rows } = await pool.query(
    `
      SELECT
        p.id,
        p.account_reference,
        p.paybill_number,
        p.amount,
        p.msisdn,
        p.receipt,
        p.created_at,
        w.id AS wallet_id
      FROM mpesa_c2b_payments p
      LEFT JOIN wallet_aliases wa
        ON wa.alias = p.account_reference
       AND wa.is_active = true
      LEFT JOIN wallets w
        ON w.id = wa.wallet_id
      WHERE p.status = 'CREDITED'
      ORDER BY p.created_at ASC
    `,
  );
  return rows.filter((r) => r.wallet_id);
}

async function getExistingLedgerRefs() {
  const { rows } = await pool.query(
    `SELECT reference_id FROM wallet_ledger WHERE reference_type = 'MPESA_C2B'`,
  );
  const set = new Set();
  rows.forEach((row) => set.add(String(row.reference_id)));
  return set;
}

async function backfill() {
  const dryRun = process.env.APPLY !== '1';
  const payments = await getCreditedPayments();
  const existingRefs = await getExistingLedgerRefs();

  const grouped = payments.reduce((acc, row) => {
    if (existingRefs.has(String(row.id))) return acc;
    const key = row.wallet_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const walletIds = Object.keys(grouped);
  if (!walletIds.length) {
    console.log('No missing ledger entries found.');
    return;
  }

  console.log(`Found ${walletIds.length} wallets with missing credits`);

  for (const walletId of walletIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const paymentsForWallet = grouped[walletId].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const totalMissing = paymentsForWallet.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const walletRes = await client.query(
        `SELECT balance, virtual_account_code FROM wallets WHERE id = $1 FOR UPDATE`,
        [walletId],
      );
      if (!walletRes.rows.length) {
        await client.query('ROLLBACK');
        continue;
      }
      const currentBalance = Number(walletRes.rows[0].balance || 0);
      const startingBalance = currentBalance - totalMissing;
      let runningBalance = startingBalance;

      console.log(
        `Wallet ${walletRes.rows[0].virtual_account_code || walletId}: inserting ${paymentsForWallet.length
        } rows (starting balance ${startingBalance})`,
      );

      for (const payment of paymentsForWallet) {
        const before = runningBalance;
        const after = before + Number(payment.amount || 0);
        runningBalance = after;
        const createdAt = payment.created_at || new Date().toISOString();

        if (dryRun) {
          console.log(
            `DRY-RUN ledger ${payment.id}: +${payment.amount} -> ${after} (${payment.receipt || payment.account_reference
            })`,
          );
          continue;
        }

        await client.query(
          `
            INSERT INTO wallet_ledger
              (wallet_id, direction, amount, balance_before, balance_after, entry_type, reference_type, reference_id, description, created_at)
            VALUES
              ($1, 'CREDIT', $2, $3, $4, 'C2B_CREDIT', 'MPESA_C2B', $5, $6, $7)
          `,
          [
            walletId,
            Number(payment.amount || 0),
            before,
            after,
            String(payment.id),
            `BACKFILL C2B ${payment.receipt || payment.account_reference || ''}`.trim(),
            createdAt,
          ],
        );
      }

      if (dryRun) {
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to backfill wallet ${walletId}:`, err.message);
    } finally {
      client.release();
    }
  }
}

backfill()
  .then(() => {
    console.log('Backfill complete.');
    return pool.end();
  })
  .catch((err) => {
    console.error('Backfill failed:', err);
    return pool.end();
  });

