const express = require('express');
const router = express.Router();
const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const {
  getMonitoringOverview,
  listCallbacks,
  listPayouts,
  listJobs,
} = require('../services/monitoring.service');

router.use(requireSystemOrSuper);

router.get('/monitoring/overview', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  try {
    const data = await getMonitoringOverview({ from, to });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/monitoring/callbacks', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const kind = req.query.kind || null;
  const result = req.query.result || null;
  const limit = Number(req.query.limit) || 50;
  try {
    const items = await listCallbacks({ from, to, kind, result, limit });
    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/monitoring/payouts', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const status = req.query.status || null;
  const limit = Number(req.query.limit) || 50;
  try {
    const items = await listPayouts({ from, to, status, limit });
    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/monitoring/jobs', async (req, res) => {
  const limit = Number(req.query.limit) || 50;
  try {
    const result = await listJobs({ limit });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
