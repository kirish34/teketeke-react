const fs = require('fs');
const path = require('path');

const app = require('../server/server');
const { buildRouteRegistry } = require('../server/utils/routeRegistry');
const { readRouteHits } = require('../server/services/routeHit.service');

const ROOT = process.cwd();
const AUDIT_DIR = path.join(ROOT, 'docs', 'route-audit');
const REGISTRY_FILE = path.join(AUDIT_DIR, 'route-registry.json');
const HITS_FILE = path.join(AUDIT_DIR, 'route-hits.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function run() {
  ensureDir(AUDIT_DIR);
  const registry = buildRouteRegistry(app);
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ items: registry }, null, 2), 'utf-8');

  const hits = await readRouteHits();
  fs.writeFileSync(HITS_FILE, JSON.stringify({ items: hits }, null, 2), 'utf-8');

  console.log('[route-audit] registry written:', REGISTRY_FILE);
  console.log('[route-audit] hits written:', HITS_FILE);
}

run().catch((err) => {
  console.error('[route-audit] export failed:', err.message);
  process.exit(1);
});
