const express = require('express');
const router = express.Router();
const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const { logAdminAction } = require('../services/audit.service');
const { creditWallet } = require('../wallet/wallet.service');

router.use(requireSystemOrSuper);

// TEMP test endpoint to manually credit a wallet (remove or protect in production)
router.post('/credit-wallet', async (req, res) => {
  try {
    const { virtualAccountCode, amount, source, sourceRef, description } = req.body || {};

    const result = await creditWallet({
      virtualAccountCode,
      amount,
      source: source || 'TEST_MANUAL',
      sourceRef: sourceRef || 'manual-ref',
      description: description || 'Manual test credit',
    });

    res.json({
      ok: true,
      message: 'Wallet credited successfully',
      data: result,
    });
    await logAdminAction({
      req,
      action: 'wallet_credit_manual',
      resource_type: 'wallet',
      resource_id: virtualAccountCode || null,
      payload: { amount, source: source || 'TEST_MANUAL' },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

module.exports = router;
