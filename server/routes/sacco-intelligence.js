const express = require('express');
const router = express.Router();
const { requireSaccoAccess } = require('../services/saccoContext.service');
const { saccoOverview, saccoVehicles } = require('../services/saccoIntelligence.service');

router.use(requireSaccoAccess({ allowSystemWithoutSacco: false }));

router.get('/intelligence/overview', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const saccoId = req.saccoId;
  if (!saccoId) return res.status(403).json({ ok: false, error: 'sacco_required' });
  try {
    const data = await saccoOverview({ saccoId, from, to });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/intelligence/vehicles', async (req, res) => {
  const saccoId = req.saccoId;
  if (!saccoId) return res.status(403).json({ ok: false, error: 'sacco_required' });
  const { status } = req.query;
  const from = req.query.from || null;
  const to = req.query.to || null;
  const limit = Number(req.query.limit) || 20;
  const offset = Number(req.query.offset) || 0;
  try {
    const data = await saccoVehicles({ saccoId, status, from, to, limit, offset });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
