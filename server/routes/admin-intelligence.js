const express = require('express');
const router = express.Router();
const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const { systemOverview, systemTrends, topEntities } = require('../services/intelligence.service');

router.use(requireSystemOrSuper);

router.get('/intelligence/overview', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  try {
    const data = await systemOverview({ from, to });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/intelligence/trends', async (req, res) => {
  const { metric } = req.query;
  const from = req.query.from || null;
  const to = req.query.to || null;
  try {
    const data = await systemTrends({ from, to, metric });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/intelligence/top-entities', async (req, res) => {
  const kind = req.query.kind || '';
  const from = req.query.from || null;
  const to = req.query.to || null;
  const limit = Number(req.query.limit) || 20;
  const offset = Number(req.query.offset) || 0;
  try {
    const data = await topEntities({ kind, from, to, limit, offset });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
