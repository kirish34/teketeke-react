const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../supabase');

const ROOT = process.cwd();
const AUDIT_DIR = path.join(ROOT, 'docs', 'route-audit');
const HITS_FILE = path.join(AUDIT_DIR, 'route-hits.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readLocalHits() {
  try {
    if (!fs.existsSync(HITS_FILE)) return { items: [] };
    const raw = fs.readFileSync(HITS_FILE, 'utf-8');
    return raw ? JSON.parse(raw) : { items: [] };
  } catch {
    return { items: [] };
  }
}

function writeLocalHits(payload) {
  ensureDir(AUDIT_DIR);
  fs.writeFileSync(HITS_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

async function recordRouteHit({ method, routeKey }) {
  const ts = new Date().toISOString();
  if (process.env.NODE_ENV === 'production') {
    if (!supabaseAdmin) return;
    const { data, error } = await supabaseAdmin
      .from('route_hits')
      .select('count')
      .eq('method', method)
      .eq('route_key', routeKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const nextCount = (data?.count || 0) + 1;
    const { error: upsertError } = await supabaseAdmin
      .from('route_hits')
      .upsert(
        { method, route_key: routeKey, count: nextCount, last_seen_at: ts },
        { onConflict: 'method,route_key' },
      );
    if (upsertError) throw new Error(upsertError.message);
    return;
  }

  const store = readLocalHits();
  const items = store.items || [];
  const idx = items.findIndex((item) => item.method === method && item.route_key === routeKey);
  if (idx >= 0) {
    items[idx] = {
      ...items[idx],
      count: Number(items[idx].count || 0) + 1,
      last_seen_at: ts,
    };
  } else {
    items.push({ method, route_key: routeKey, count: 1, last_seen_at: ts });
  }
  writeLocalHits({ items });
}

async function readRouteHits() {
  if (process.env.NODE_ENV === 'production') {
    if (!supabaseAdmin) return [];
    const { data, error } = await supabaseAdmin
      .from('route_hits')
      .select('method, route_key, count, last_seen_at')
      .order('last_seen_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }
  const store = readLocalHits();
  return store.items || [];
}

async function bumpTestRouteHit() {
  const key = 'GET /__route_hits_test__';
  await recordRouteHit({ method: 'GET', routeKey: key });
  const items = await readRouteHits();
  const match = items.find((item) => item.method === 'GET' && item.route_key === key);
  return { key, count: match?.count || 1 };
}

module.exports = {
  recordRouteHit,
  readRouteHits,
  bumpTestRouteHit,
  HITS_FILE,
};
