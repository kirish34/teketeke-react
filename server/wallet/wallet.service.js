// server/wallet/wallet.service.js
// Handles wallet balance updates and transaction history.
const pool = require('../db/pool');
const { generateVirtualAccountCode } = require('./wallet.utils');
const { ensureWalletAliasesForMatatu, ensurePaybillAlias } = require('./wallet.aliases');
const {
  creditWalletWithLedger,
  debitWalletWithLedger,
  newReferenceId,
} = require('../services/walletLedger.service');
const { resolveActiveTripIdForMatatu } = require('../services/trip.service');
const { resolveActiveShiftIdForMatatu } = require('../services/shift.service');

function mapEntryTypeFromSource(source) {
  const normalized = String(source || '').trim().toUpperCase();
  if (normalized === 'MPESA_C2B') return 'C2B_CREDIT';
  if (normalized === 'MPESA_STK') return 'STK_CREDIT';
  if (normalized === 'SACCO_PAYOUT') return 'PAYOUT_DEBIT';
  return 'MANUAL_ADJUSTMENT';
}

function mapReferenceTypeFromSource(source) {
  const normalized = String(source || '').trim().toUpperCase();
  if (normalized === 'SACCO_PAYOUT') return 'PAYOUT_ITEM';
  if (normalized === 'MPESA_C2B' || normalized === 'MPESA_STK') return 'MPESA_C2B';
  return 'ADMIN';
}

/**
 * Credit a wallet by virtualAccountCode.
 * Uses a DB transaction to lock the wallet row, update balance, and log history.
 *
 * @param {Object} params
 * @param {string} params.virtualAccountCode - e.g. 'MAT0021'
 * @param {number|string} params.amount - positive amount in KES
 * @param {string} [params.source] - e.g. 'MPESA_STK'
 * @param {string} [params.sourceRef] - e.g. receipt or callback id
 * @param {string} [params.description] - human-readable description
 */
async function creditWallet({
  virtualAccountCode,
  amount,
  source = null,
  sourceRef = null,
  description = null,
}) {
  if (!virtualAccountCode) {
    throw new Error('virtualAccountCode is required');
  }
  if (!amount || Number(amount) <= 0) {
    throw new Error('amount must be a positive number');
  }

  const walletRes = await pool.query(
    `
      SELECT id
      FROM wallets
      WHERE virtual_account_code = $1
      LIMIT 1
    `,
    [virtualAccountCode],
  );

  if (walletRes.rows.length === 0) {
    throw new Error(`Wallet not found for virtualAccountCode=${virtualAccountCode}`);
  }

  const entryType = mapEntryTypeFromSource(source);
  const referenceType = mapReferenceTypeFromSource(source);
  const referenceId = sourceRef || newReferenceId();

  const result = await creditWalletWithLedger({
    walletId: walletRes.rows[0].id,
    amount,
    entryType,
    referenceType,
    referenceId,
    description,
    provider: source ? 'mpesa' : null,
    providerRef: sourceRef || null,
    source,
    sourceRef: sourceRef || null,
  });

  return {
    walletId: result.walletId,
    balanceBefore: result.balanceBefore,
    balanceAfter: result.balanceAfter,
  };
}

/**
 * Debit wallet by walletId.
 * Uses a DB transaction to lock the wallet row, update balance, and log history.
 */
async function debitWallet({
  walletId,
  amount,
  source = null,
  sourceRef = null,
  description = null,
  entryType = null,
  referenceType = null,
  referenceId = null,
  client = null,
}) {
  if (!walletId) {
    throw new Error('walletId is required');
  }
  if (!amount || Number(amount) <= 0) {
    throw new Error('amount must be a positive number');
  }

  const effectiveEntryType = entryType || mapEntryTypeFromSource(source);
  const effectiveReferenceType = referenceType || mapReferenceTypeFromSource(source);
  const effectiveReferenceId = referenceId || sourceRef || newReferenceId();

  try {
    const result = await debitWalletWithLedger({
      walletId,
      amount,
      entryType: effectiveEntryType,
      referenceType: effectiveReferenceType,
      referenceId: effectiveReferenceId,
      description,
      provider: source ? 'mpesa' : null,
      providerRef: sourceRef || null,
      source,
      sourceRef: sourceRef || null,
      client,
    });

    return {
      walletId: result.walletId,
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
    };
  } catch (err) {
    console.error('Error in debitWallet:', err.message);
    throw err;
  }
}

/**
 * Debit wallet by virtualAccountCode and create a withdrawals row.
 * Locks the wallet, checks balance, records DEBIT, and seeds withdrawals as PENDING.
 */
async function debitWalletAndCreateWithdrawal({
  virtualAccountCode,
  amount,
  phoneNumber,
}) {
  if (!virtualAccountCode) throw new Error('virtualAccountCode is required');
  if (!amount || Number(amount) <= 0) throw new Error('amount must be > 0');
  if (!phoneNumber) throw new Error('phoneNumber is required');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const walletRes = await client.query(
      `
        SELECT id
        FROM wallets
        WHERE virtual_account_code = $1
        LIMIT 1
      `,
      [virtualAccountCode],
    );

    if (walletRes.rows.length === 0) {
      throw new Error(`Wallet not found for virtualAccountCode=${virtualAccountCode}`);
    }

    const walletId = walletRes.rows[0].id;
    const amountNumber = Number(amount);
    const withdrawalId = newReferenceId();

    const debitResult = await debitWalletWithLedger({
      walletId,
      amount: amountNumber,
      entryType: 'MANUAL_ADJUSTMENT',
      referenceType: 'ADMIN',
      referenceId: withdrawalId,
      description: `Withdrawal to ${phoneNumber}`,
      client,
    });

    const withdrawalRes = await client.query(
      `
        INSERT INTO withdrawals
          (id, wallet_id, amount, phone_number, status)
        VALUES
          ($1, $2, $3, $4, 'PENDING')
        RETURNING id, status, created_at
      `,
      [withdrawalId, walletId, amountNumber, phoneNumber],
    );

    const withdrawal = withdrawalRes.rows[0];

    await client.query('COMMIT');

    return {
      walletId,
      balanceBefore: debitResult.balanceBefore,
      balanceAfter: debitResult.balanceAfter,
      withdrawalId: withdrawal.id,
      withdrawalStatus: withdrawal.status,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in debitWalletAndCreateWithdrawal:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get a wallet by virtualAccountCode with current balance + meta.
 */
async function getWalletByVirtualAccountCode(virtualAccountCode) {
  if (!virtualAccountCode) throw new Error('virtualAccountCode is required');

  const res = await pool.query(
    `
      SELECT id, entity_type, entity_id, virtual_account_code, balance, currency, created_at, updated_at
      FROM wallets
      WHERE virtual_account_code = $1
    `,
    [virtualAccountCode]
  );

  if (res.rows.length === 0) {
    throw new Error(`Wallet not found for virtualAccountCode=${virtualAccountCode}`);
  }

  return res.rows[0];
}

/**
 * Get paginated transaction history for a wallet.
 */
async function getWalletTransactions({ virtualAccountCode, limit = 20, offset = 0 }) {
  if (!virtualAccountCode) throw new Error('virtualAccountCode is required');

  const walletRes = await pool.query(
    `
      SELECT id
      FROM wallets
      WHERE virtual_account_code = $1
    `,
    [virtualAccountCode]
  );

  if (walletRes.rows.length === 0) {
    throw new Error(`Wallet not found for virtualAccountCode=${virtualAccountCode}`);
  }

  const walletId = walletRes.rows[0].id;

  const txRes = await pool.query(
    `
      SELECT
        id,
        direction AS tx_type,
        amount,
        balance_before,
        balance_after,
        entry_type AS source,
        reference_id AS source_ref,
        description,
        created_at
      FROM wallet_ledger
      WHERE wallet_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [walletId, limit, offset],
  );

  const countRes = await pool.query(
    `
      SELECT COUNT(*)::int as total
      FROM wallet_ledger
      WHERE wallet_id = $1
    `,
    [walletId],
  );

  return {
    walletId,
    total: countRes.rows[0].total,
    transactions: txRes.rows,
  };
}

/**
 * Credit a matatu wallet for a fare, applying fee rules (SACCO + TekeTeke).
 * Calculates net to matatu and credits fee beneficiary wallets inside one transaction.
 */
async function creditFareWithFeesByWalletId({
  walletId,
  amount,
  source = 'MPESA_C2B',
  sourceRef = null,
  referenceId = null,
  referenceType = null,
  description = null,
  client = null,
  tripId: tripIdOverride = null,
  shiftId: shiftIdOverride = null,
}) {
  if (!walletId) throw new Error('walletId is required');
  if (!amount || Number(amount) <= 0) throw new Error('amount must be > 0');

  const useClient = client || (await pool.connect());
  const ownTx = !client;

  try {
    if (ownTx) await useClient.query('BEGIN');

    const grossAmount = Number(amount);
    const entryType = mapEntryTypeFromSource(source);
    const effectiveReferenceType = referenceType || mapReferenceTypeFromSource(source);
    const effectiveReferenceId = referenceId || sourceRef || newReferenceId();

    // Lock matatu wallet
    const matatuRes = await useClient.query(
      `
        SELECT id, virtual_account_code, matatu_id
        FROM wallets
        WHERE id = $1
      `,
      [walletId]
    );

    if (matatuRes.rows.length === 0) {
      throw new Error(`Matatu wallet not found for wallet_id=${walletId}`);
    }

    const matatuWallet = matatuRes.rows[0];
    const virtualAccountCode = matatuWallet.virtual_account_code;
    const tripId = tripIdOverride ?? (await resolveActiveTripIdForMatatu(matatuWallet.matatu_id));
    const shiftId = shiftIdOverride ?? (await resolveActiveShiftIdForMatatu(matatuWallet.matatu_id));

    // Active fees for matatu fare
    const feesRes = await useClient.query(
      `
        SELECT id, name, fee_type, fee_value, beneficiary_wallet_id
        FROM fees_config
        WHERE applies_to = 'MATATU_FARE'
          AND active = true
      `
    );

    const feeConfigs = feesRes.rows;
    const feeDetails = [];
    let totalFees = 0;

    for (const fee of feeConfigs) {
      if (!fee.beneficiary_wallet_id) {
        console.warn(`Fee ${fee.id} has no beneficiary_wallet_id, skipping.`);
        continue;
      }

      let feeAmount = 0;
      if (fee.fee_type === 'PERCENT') {
        feeAmount = grossAmount * Number(fee.fee_value);
      } else if (fee.fee_type === 'FLAT') {
        feeAmount = Number(fee.fee_value);
      } else {
        console.warn(`Unknown fee_type for fee ${fee.id}, skipping.`);
        continue;
      }

      if (feeAmount <= 0) continue;

      totalFees += feeAmount;
      feeDetails.push({
        configId: fee.id,
        name: fee.name,
        beneficiaryWalletId: fee.beneficiary_wallet_id,
        amount: feeAmount,
      });
    }

    if (totalFees > grossAmount) {
      throw new Error('Total fees exceed gross amount');
    }

    const netToMatatu = grossAmount - totalFees;

    // Credit net to matatu wallet
    const matatuResult = await creditWalletWithLedger({
      walletId: matatuWallet.id,
      amount: netToMatatu,
      entryType,
      referenceType: effectiveReferenceType,
      referenceId: effectiveReferenceId,
      description: description || `Fare credit (net) from ${source}`,
      provider: source ? 'mpesa' : null,
      providerRef: sourceRef || null,
      source,
      sourceRef: sourceRef || null,
      tripId: tripId || null,
      shiftId: shiftId || null,
      client: useClient,
    });

    // Credit fee beneficiary wallets
    for (const fee of feeDetails) {
      try {
        await creditWalletWithLedger({
          walletId: fee.beneficiaryWalletId,
          amount: fee.amount,
          entryType,
          referenceType: effectiveReferenceType,
          referenceId: effectiveReferenceId,
          description: `Fee: ${fee.name} from fare on ${virtualAccountCode || walletId}`,
          provider: source ? 'mpesa' : null,
          providerRef: sourceRef || null,
          source,
          sourceRef: sourceRef || null,
          client: useClient,
        });
      } catch (err) {
        const msg = String(err.message || '').toLowerCase();
        if (msg.includes('wallet not found')) {
          console.warn(`Beneficiary wallet ${fee.beneficiaryWalletId} not found, skipping fee.`);
          continue;
        }
        throw err;
      }
    }

    if (ownTx) await useClient.query('COMMIT');

    return {
      virtualAccountCode,
      grossAmount,
      netToMatatu,
      totalFees,
      feeDetails,
      matatuWalletId: matatuWallet.id,
      matatuBalanceBefore: matatuResult.balanceBefore,
      matatuBalanceAfter: matatuResult.balanceAfter,
      tripId: tripId || null,
      shiftId: shiftId || null,
    };
  } catch (err) {
    if (ownTx) await useClient.query('ROLLBACK');
    console.error('Error in creditFareWithFeesByWalletId:', err.message);
    throw err;
  } finally {
    if (ownTx) useClient.release();
  }
}

async function creditFareWithFees({
  virtualAccountCode,
  amount,
  source = 'MPESA_C2B',
  sourceRef = null,
  referenceId = null,
  referenceType = null,
  description = null,
}) {
  if (!virtualAccountCode) throw new Error('virtualAccountCode is required');

  const res = await pool.query(
    `
      SELECT id
      FROM wallets
      WHERE virtual_account_code = $1
      LIMIT 1
    `,
    [virtualAccountCode]
  );

  if (!res.rows.length) {
    throw new Error(`Matatu wallet not found for virtualAccountCode=${virtualAccountCode}`);
  }

  return creditFareWithFeesByWalletId({
    walletId: res.rows[0].id,
    amount,
    source,
    sourceRef,
    referenceId,
    referenceType,
    description,
  });
}

module.exports = {
  creditWallet,
  debitWallet,
  debitWalletAndCreateWithdrawal,
  getWalletByVirtualAccountCode,
  getWalletTransactions,
  creditFareWithFees,
  creditFareWithFeesByWalletId,
};

async function createWalletRecord({
  entityType,
  entityId,
  walletType,
  walletKind = null,
  saccoId = null,
  matatuId = null,
  numericRef,
  client = null,
}) {
  if (!entityType) throw new Error('entityType is required');
  if (!entityId) throw new Error('entityId is required');
  if (!walletType) throw new Error('walletType is required');

  const useClient = client || (await pool.connect());
  const ownTx = !client;

  try {
    if (ownTx) await useClient.query('BEGIN');

    const baseRef = Number(numericRef) || Date.now() % 100000;
    let walletRow = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateVirtualAccountCode(entityType, baseRef + attempt);
      const savepoint = `wallet_create_${attempt}`;
      if (useClient?.query) {
        await useClient.query(`SAVEPOINT ${savepoint}`);
      }
      try {
        const walletRes = await useClient.query(
          `
            INSERT INTO wallets
              (entity_type, entity_id, virtual_account_code, balance, wallet_type, wallet_code, sacco_id, matatu_id, wallet_kind)
            VALUES
              ($1, $2, $3, 0, $4, $5, $6, $7, $8)
            RETURNING id, virtual_account_code, wallet_code, wallet_type, wallet_kind, balance
          `,
          [entityType, entityId, code, walletType, code, saccoId, matatuId, walletKind]
        );
        walletRow = walletRes.rows[0];
        if (useClient?.query) {
          await useClient.query(`RELEASE SAVEPOINT ${savepoint}`);
        }
        break;
      } catch (e) {
        if (useClient?.query) {
          await useClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await useClient.query(`RELEASE SAVEPOINT ${savepoint}`);
        }
        const msg = String(e.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) continue;
        throw e;
      }
    }

    if (!walletRow) {
      throw new Error('Could not generate a unique virtual account code');
    }

    if (ownTx) await useClient.query('COMMIT');
    return walletRow;
  } catch (err) {
    if (ownTx) await useClient.query('ROLLBACK');
    throw err;
  } finally {
    if (ownTx) useClient.release();
  }
}

/**
 * Create a wallet for a given entity and attach wallet_id on the entity table.
 */
async function registerWalletForEntity({
  entityType,
  entityId,
  numericRef,
  walletKind = null,
  paybillKey = null,
  plate = null,
  attachToEntity = true,
} = {}) {
  if (!entityType) throw new Error('entityType is required');
  if (!entityId) throw new Error('entityId is required');

  const type = String(entityType).toUpperCase();
  let walletType;
  let saccoId = null;
  let matatuId = null;
  let tableName;
  switch (type) {
    case 'MATATU':
      tableName = 'matatus';
      walletType = 'matatu';
      matatuId = entityId;
      break;
    case 'SACCO':
      tableName = 'saccos';
      walletType = 'sacco';
      saccoId = entityId;
      break;
    case 'TAXI':
      tableName = 'matatus';
      walletType = 'matatu';
      matatuId = entityId;
      break;
    case 'BODABODA':
    case 'BODA':
      tableName = 'matatus';
      walletType = 'matatu';
      matatuId = entityId;
      break;
    default:
      throw new Error(`Unknown entityType ${entityType}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let effectivePaybillKey = paybillKey;
    if (!effectivePaybillKey) {
      if (type === 'SACCO') effectivePaybillKey = '30';
      if (type === 'MATATU') effectivePaybillKey = '11';
      if (type === 'TAXI') effectivePaybillKey = '40';
      if (type === 'BODABODA' || type === 'BODA') effectivePaybillKey = '50';
    }

    const walletRow = await createWalletRecord({
      entityType: type,
      entityId,
      walletType,
      walletKind,
      saccoId,
      matatuId,
      numericRef,
      client,
    });

    if (attachToEntity) {
      await client.query(
        `UPDATE ${tableName} SET wallet_id = $1 WHERE id = $2`,
        [walletRow.id, entityId]
      );
    }

    if (type === 'MATATU') {
      let plateValue = plate || null;
      if (!plateValue) {
        const plateRes = await client.query(
          `
            SELECT number_plate
            FROM matatus
            WHERE id = $1
            LIMIT 1
          `,
          [entityId]
        );
        plateValue = plateRes.rows[0]?.number_plate || null;
      }
      await ensureWalletAliasesForMatatu({
        walletId: walletRow.id,
        plate: plateValue,
        client,
        paybillKey: effectivePaybillKey || '11',
      });
    } else if (effectivePaybillKey) {
      await ensurePaybillAlias({ walletId: walletRow.id, client, key: effectivePaybillKey });
    }

    await client.query('COMMIT');
    return walletRow;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in registerWalletForEntity:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create a BANK withdrawal: debit wallet and create pending withdrawal record.
 */
async function createBankWithdrawal({
  virtualAccountCode,
  amount,
  bankName,
  bankBranch,
  bankAccountNumber,
  bankAccountName,
  feePercent = 0.01,
}) {
  if (!virtualAccountCode) throw new Error('virtualAccountCode is required');
  if (!amount || Number(amount) <= 0) throw new Error('amount must be > 0');
  if (!bankName || !bankAccountNumber || !bankAccountName) {
    throw new Error('Bank name, account number, and account name are required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const wRes = await client.query(
      `
        SELECT id
        FROM wallets
        WHERE virtual_account_code = $1
        LIMIT 1
      `,
      [virtualAccountCode],
    );
    if (!wRes.rows.length) throw new Error(`Wallet not found for ${virtualAccountCode}`);

    const walletId = wRes.rows[0].id;
    const grossAmount = Number(amount);
    const feeAmount = feePercent > 0 ? grossAmount * feePercent : 0;
    const netPayout = grossAmount - feeAmount;
    if (netPayout <= 0) throw new Error('Net payout must be > 0');

    const withdrawalId = newReferenceId();
    const debitResult = await debitWalletWithLedger({
      walletId,
      amount: grossAmount,
      entryType: 'MANUAL_ADJUSTMENT',
      referenceType: 'ADMIN',
      referenceId: withdrawalId,
      description: `Bank withdrawal request to ${bankName} (${bankAccountNumber})`,
      client,
    });

    const wdRes = await client.query(
      `
        INSERT INTO withdrawals
          (id, wallet_id, amount, phone_number, status, method,
           bank_name, bank_branch, bank_account_number, bank_account_name,
           failure_reason, mpesa_transaction_id, mpesa_conversation_id,
           mpesa_response, internal_note)
        VALUES
          ($1, $2, $3, null, 'PENDING', 'BANK',
           $3, $4, $5, $6,
           null, null, null,
           null, null)
        RETURNING id, created_at
      `,
      [
        withdrawalId,
        walletId,
        netPayout,
        bankName,
        bankBranch || null,
        bankAccountNumber,
        bankAccountName,
      ],
    );

    const withdrawal = wdRes.rows[0];

    await client.query('COMMIT');

    return {
      withdrawalId: withdrawal.id,
      walletId,
      grossAmount,
      feeAmount,
      netPayout,
      balanceBefore: debitResult.balanceBefore,
      balanceAfter: debitResult.balanceAfter,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in createBankWithdrawal:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  creditWallet,
  debitWallet,
  debitWalletAndCreateWithdrawal,
  getWalletByVirtualAccountCode,
  getWalletTransactions,
  creditFareWithFees,
  creditFareWithFeesByWalletId,
  createBankWithdrawal,
  createWalletRecord,
  registerWalletForEntity,
};
