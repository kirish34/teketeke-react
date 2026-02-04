const express = require('express');
const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const { buildRouteRegistry } = require('../utils/routeRegistry');
const { readRouteHits, bumpTestRouteHit } = require('../services/routeHit.service');

const router = express.Router();

router.use(requireSystemOrSuper);

router.get('/routes', (req, res) => {
  if (String(req.query.registry || '') !== '1') {
    return res.status(400).json({ ok: false, error: 'missing registry=1' });
  }
  const routes = buildRouteRegistry(req.app);
  return res.json({ ok: true, items: routes });
});

router.get('/route-hits', async (_req, res) => {
  try {
    const items = await readRouteHits();
    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/route-hits/test-bump', async (_req, res) => {
  try {
    const result = await bumpTestRouteHit();
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
