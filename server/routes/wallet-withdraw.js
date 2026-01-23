const express = require('express');
const router = express.Router();

const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const { logAdminAction } = require('../services/audit.service');
const {
  debitWalletAndCreateWithdrawal,
  createBankWithdrawal,
  getWalletByVirtualAccountCode,
  getWalletTransactions,
} = require('../wallet/wallet.service');
const { sendB2CPayment } = require('../mpesa/mpesaB2C.service');

router.use('/wallets', requireSystemOrSuper);

async function logWalletAdminAction(req, action, resourceId = null, payload = null) {
  try {
    await logAdminAction({
      req,
      action,
      resource_type: 'wallet',
      resource_id: resourceId,
      payload,
    });
  } catch {
    // best-effort audit log
  }
}

/**
 * GET /wallets/:virtualAccountCode
 * Returns wallet summary with current balance.
 */
router.get('/wallets/:virtualAccountCode', async (req, res) => {
  const { virtualAccountCode } = req.params;

  try {
    const wallet = await getWalletByVirtualAccountCode(virtualAccountCode);
    return res.json({ ok: true, wallet });
  } catch (err) {
    console.error('Error in GET /wallets/:virtualAccountCode:', err.message);
    return res.status(404).json({ ok: false, error: err.message });
  }
});

/**
 * GET /wallets/:virtualAccountCode/transactions?limit=20&offset=0
 * Returns transaction history for a wallet.
 */
router.get('/wallets/:virtualAccountCode/transactions', async (req, res) => {
  const { virtualAccountCode } = req.params;
  const limit = Number(req.query.limit) || 20;
  const offset = Number(req.query.offset) || 0;

  try {
    const result = await getWalletTransactions({ virtualAccountCode, limit, offset });
    return res.json({
      ok: true,
      walletId: result.walletId,
      total: result.total,
      transactions: result.transactions,
    });
  } catch (err) {
    console.error('Error in GET /wallets/:virtualAccountCode/transactions:', err.message);
    return res.status(404).json({ ok: false, error: err.message });
  }
});

/**
 * POST /wallets/:virtualAccountCode/withdraw
 * Body: { amount, phoneNumber }
 */
router.post('/wallets/:virtualAccountCode/withdraw', async (req, res) => {
  const { virtualAccountCode } = req.params;
  const { amount, phoneNumber } = req.body || {};

  try {
    const withdrawalData = await debitWalletAndCreateWithdrawal({
      virtualAccountCode,
      amount,
      phoneNumber,
    });

    const b2cResult = await sendB2CPayment({
      withdrawalId: withdrawalData.withdrawalId,
      amount,
      phoneNumber,
    });

    return res.json({
      ok: true,
      message: 'Withdrawal initiated',
      data: {
        wallet: {
          walletId: withdrawalData.walletId,
          balanceBefore: withdrawalData.balanceBefore,
          balanceAfter: withdrawalData.balanceAfter,
        },
        withdrawal: {
          withdrawalId: withdrawalData.withdrawalId,
          status: withdrawalData.withdrawalStatus,
        },
        mpesa: b2cResult.mpesa,
      },
    });
    await logWalletAdminAction(req, 'wallet_withdraw_mpesa', virtualAccountCode, {
      amount,
      phoneNumber,
      withdrawalId: withdrawalData.withdrawalId,
    });
  } catch (err) {
    console.error('Error in withdraw route:', err.message);
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * POST /wallets/:virtualAccountCode/withdraw/bank
 * Body: { amount, bankName, bankBranch, bankAccountNumber, bankAccountName, feePercent? }
 */
router.post('/wallets/:virtualAccountCode/withdraw/bank', async (req, res) => {
  const { virtualAccountCode } = req.params;
  const {
    amount,
    bankName,
    bankBranch,
    bankAccountNumber,
    bankAccountName,
    feePercent,
  } = req.body || {};

  try {
    const result = await createBankWithdrawal({
      virtualAccountCode,
      amount,
      bankName,
      bankBranch,
      bankAccountNumber,
      bankAccountName,
      feePercent,
    });
    return res.json({
      ok: true,
      message: 'Bank withdrawal request created',
      data: result,
    });
    await logWalletAdminAction(req, 'wallet_withdraw_bank', virtualAccountCode, {
      amount,
      bankName,
      bankBranch,
      bankAccountNumber,
    });
  } catch (err) {
    console.error('Error in bank withdraw route:', err.message);
    return res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
