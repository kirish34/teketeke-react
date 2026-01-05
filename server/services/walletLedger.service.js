const crypto = require('crypto');
const pool = require('../db/pool');

const ENTRY_TYPES = new Set([
  'C2B_CREDIT',
  'STK_CREDIT',
  'PAYOUT_DEBIT',
  'MANUAL_ADJUSTMENT',
  'REVERSAL',
]);

const REFERENCE_TYPES = new Set(['MPESA_C2B', 'PAYOUT_ITEM', 'ADMIN']);

function normalizeEntryType(entryType) {
  const value = String(entryType || '').trim().toUpperCase();
  if (!ENTRY_TYPES.has(value)) {
    throw new Error(`Invalid ledger entry_type: ${entryType}`);
  }
  return value;
}

function normalizeReferenceType(referenceType) {
  const value = String(referenceType || '').trim().toUpperCase();
  if (!REFERENCE_TYPES.has(value)) {
    throw new Error(`Invalid ledger reference_type: ${referenceType}`);
  }
  return value;
}

function normalizeReferenceId(referenceId) {
  const value = String(referenceId || '').trim();
  if (!value) {
    throw new Error('reference_id is required');
  }
  return value;
}

function normalizeAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('amount must be a positive number');
  }
  return value;
}

async function creditWalletWithLedger({
  walletId,
  amount,
  entryType,
  referenceType,
  referenceId,
  description = null,
  client = null,
}) {
  if (!walletId) throw new Error('walletId is required');

  const normalizedEntryType = normalizeEntryType(entryType);
  const normalizedReferenceType = normalizeReferenceType(referenceType);
  const normalizedReferenceId = normalizeReferenceId(referenceId);
  const amountValue = normalizeAmount(amount);

  const useClient = client || (await pool.connect());
  const ownTx = !client;

  try {
    if (ownTx) await useClient.query('BEGIN');

    const walletRes = await useClient.query(
      `
        SELECT id, balance
        FROM wallets
        WHERE id = $1
        FOR UPDATE
      `,
      [walletId],
    );
    if (!walletRes.rows.length) {
      throw new Error(`Wallet not found for walletId=${walletId}`);
    }

    const balanceBefore = Number(walletRes.rows[0].balance || 0);
    const balanceAfter = balanceBefore + amountValue;

    await useClient.query(
      `UPDATE wallets SET balance = $1 WHERE id = $2`,
      [balanceAfter, walletId],
    );

    const ledgerRes = await useClient.query(
      `
        INSERT INTO wallet_ledger
          (wallet_id, direction, amount, balance_before, balance_after, entry_type, reference_type, reference_id, description)
        VALUES
          ($1, 'CREDIT', $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        walletId,
        amountValue,
        balanceBefore,
        balanceAfter,
        normalizedEntryType,
        normalizedReferenceType,
        normalizedReferenceId,
        description,
      ],
    );

    if (ownTx) await useClient.query('COMMIT');

    return {
      walletId,
      balanceBefore,
      balanceAfter,
      ledgerId: ledgerRes.rows[0]?.id || null,
      referenceId: normalizedReferenceId,
    };
  } catch (err) {
    if (ownTx) await useClient.query('ROLLBACK');
    throw err;
  } finally {
    if (ownTx) useClient.release();
  }
}

async function debitWalletWithLedger({
  walletId,
  amount,
  entryType = 'PAYOUT_DEBIT',
  referenceType = 'PAYOUT_ITEM',
  referenceId,
  description = null,
  client = null,
}) {
  if (!walletId) throw new Error('walletId is required');

  const normalizedEntryType = normalizeEntryType(entryType);
  const normalizedReferenceType = normalizeReferenceType(referenceType);
  const normalizedReferenceId = normalizeReferenceId(referenceId);
  const amountValue = normalizeAmount(amount);

  const useClient = client || (await pool.connect());
  const ownTx = !client;

  try {
    if (ownTx) await useClient.query('BEGIN');

    const walletRes = await useClient.query(
      `
        SELECT id, balance
        FROM wallets
        WHERE id = $1
        FOR UPDATE
      `,
      [walletId],
    );
    if (!walletRes.rows.length) {
      throw new Error(`Wallet not found for walletId=${walletId}`);
    }

    const balanceBefore = Number(walletRes.rows[0].balance || 0);
    if (balanceBefore < amountValue) {
      throw new Error('INSUFFICIENT_BALANCE');
    }
    const balanceAfter = balanceBefore - amountValue;

    await useClient.query(
      `UPDATE wallets SET balance = $1 WHERE id = $2`,
      [balanceAfter, walletId],
    );

    const ledgerRes = await useClient.query(
      `
        INSERT INTO wallet_ledger
          (wallet_id, direction, amount, balance_before, balance_after, entry_type, reference_type, reference_id, description)
        VALUES
          ($1, 'DEBIT', $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        walletId,
        amountValue,
        balanceBefore,
        balanceAfter,
        normalizedEntryType,
        normalizedReferenceType,
        normalizedReferenceId,
        description,
      ],
    );

    if (ownTx) await useClient.query('COMMIT');

    return {
      walletId,
      balanceBefore,
      balanceAfter,
      ledgerId: ledgerRes.rows[0]?.id || null,
      referenceId: normalizedReferenceId,
    };
  } catch (err) {
    if (ownTx) await useClient.query('ROLLBACK');
    throw err;
  } finally {
    if (ownTx) useClient.release();
  }
}

function newReferenceId() {
  return crypto.randomUUID();
}

module.exports = {
  creditWalletWithLedger,
  debitWalletWithLedger,
  newReferenceId,
  ENTRY_TYPES,
  REFERENCE_TYPES,
};
