const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.MOCK_SUPABASE_ADMIN !== '0') {
  process.env.MOCK_SUPABASE_ADMIN = process.env.MOCK_SUPABASE_ADMIN || '1';
}
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/teketeke_dev';

const silentLogs = process.env.ROUTE_REGISTRY_SILENT !== '0';
if (silentLogs) {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
}

const app = require(path.join(__dirname, '..', 'server', 'server'));
const { supabaseAdmin } = require(path.join(__dirname, '..', 'server', 'supabase'));
const ROOT = path.join(__dirname, '..');
const hitsPath = path.join(ROOT, 'docs', 'route-audit', 'route-hits.json');

function joinPaths(prefix, suffix) {
  const safePrefix = typeof prefix === 'string' ? prefix : '';
  if (!safePrefix && !suffix) return '';
  if (!suffix) return safePrefix || '';
  const suffixText = typeof suffix === 'string' ? suffix : String(suffix);
  const left = safePrefix.endsWith('/') ? safePrefix.slice(0, -1) : safePrefix;
  const right = suffixText.startsWith('/') ? suffixText : `/${suffixText}`;
  const joined = `${left}${right}` || '';
  return joined === '//' ? '/' : joined;
}

function regexpToPath(regexp) {
  if (!regexp) return '';
  if (regexp.fast_slash) return '';
  const src = regexp.source;
  const match = src.match(/^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)$/);
  if (match) return `/${match[1].replace(/\\\//g, '/')}`;
  const matchAlt = src.match(/^\^\\\/(.+?)\(\?=\\\/\|\$\)$/);
  if (matchAlt) return `/${matchAlt[1].replace(/\\\//g, '/')}`;
  return '';
}

function walk(stack, prefix = '') {
  const routes = [];
  for (const layer of stack) {
    if (layer.route && layer.route.path) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
      for (const routePath of paths) {
        const path = joinPaths(prefix, routePath);
        for (const method of methods) {
          routes.push({ method: method.toUpperCase(), path });
        }
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const layerPath = layer.path || regexpToPath(layer.regexp);
      routes.push(...walk(layer.handle.stack, joinPaths(prefix, layerPath)));
    }
  }
  return routes;
}

const routes = walk(app._router?.stack || []);
const unique = Array.from(
  new Map(routes.map((route) => [`${route.method} ${route.path}`, route])).values(),
).sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));

const payload = {
  generated_at: new Date().toISOString(),
  items: unique,
};

async function exportRouteHits() {
  const now = new Date().toISOString();
  const useSupabase =
    process.env.NODE_ENV === 'production' && supabaseAdmin && process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (useSupabase) {
    const { data, error } = await supabaseAdmin
      .from('route_hits')
      .select('method, route_key, count, last_seen_at')
      .order('route_key', { ascending: true });
    if (error) {
      throw new Error(error.message || String(error));
    }
    const items = (data || []).map((row) => ({
      ...row,
      key: `${row.method} ${row.route_key}`,
    }));
    return { generated_at: now, source: 'supabase', items };
  }

  let local = { generated_at: now, source: 'local', items: [] };
  if (fs.existsSync(hitsPath)) {
    try {
      const raw = fs.readFileSync(hitsPath, 'utf-8');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.items)) {
        local = {
          generated_at: now,
          source: parsed.source || 'local',
          items: parsed.items,
        };
      }
    } catch {
      local = { generated_at: now, source: 'local', items: [] };
    }
  }
  return local;
}

exportRouteHits()
  .then((routeHits) => {
    fs.mkdirSync(path.dirname(hitsPath), { recursive: true });
    fs.writeFileSync(hitsPath, JSON.stringify(routeHits, null, 2));
  })
  .catch((err) => {
    if (!silentLogs) console.error('[route-hits] export failed', err?.message || err);
  });

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
