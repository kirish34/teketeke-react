const express = require('express');
const router = express.Router();
const { requireAdminAccess } = require('../middleware/admin-access');
const { creditWallet } = require('../wallet/wallet.service');

router.use(requireAdminAccess);

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
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

module.exports = router;
