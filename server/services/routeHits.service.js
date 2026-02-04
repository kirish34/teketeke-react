const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../supabase');

const ROOT = process.cwd();
const isProd = process.env.NODE_ENV === 'production';
const hitsFile =
  process.env.ROUTE_HITS_JSON_PATH || path.join(ROOT, 'docs', 'route-audit', 'route-hits.json');
const flushMs = Number(process.env.ROUTE_HITS_FLUSH_MS || (isProd ? 60000 : 10000));

const store = new Map();
let intervalId = null;
let flushing = false;

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeItem(item) {
  if (!item || !item.method || !item.route_key) return null;
  const key = `${item.method} ${item.route_key}`;
  return {
    key,
    method: item.method,
    route_key: item.route_key,
    count: Number(item.count || 0),
    last_seen_at: item.last_seen_at || null,
    pending: 0,
  };
}

function loadLocalStore() {
  try {
    if (!fs.existsSync(hitsFile)) return;
    const raw = fs.readFileSync(hitsFile, 'utf-8');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    items.forEach((item) => {
      const normalized = normalizeItem(item);
      if (normalized) store.set(normalized.key, normalized);
    });
  } catch {
    // ignore malformed local store
  }
}

function serializeStore(source) {
  const items = Array.from(store.values())
    .map((entry) => ({
      method: entry.method,
      route_key: entry.route_key,
      key: entry.key,
      count: entry.count,
      last_seen_at: entry.last_seen_at,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    generated_at: nowIso(),
    source,
    items,
  };
}

function writeLocalStore() {
  if (isProd) return;
  try {
    ensureDir(hitsFile);
    const payload = serializeStore('local');
    fs.writeFileSync(hitsFile, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.warn('[route-hits] failed to write local store', err?.message || err);
  }
}

async function upsertRouteHit(entry, delta) {
  if (!supabaseAdmin) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from('route_hits')
      .select('count')
      .eq('method', entry.method)
      .eq('route_key', entry.route_key)
      .maybeSingle();
    if (error) throw error;
    const current = Number(data?.count || 0);
    const nextCount = current + delta;
    const { error: upsertError } = await supabaseAdmin
      .from('route_hits')
      .upsert(
        {
          method: entry.method,
          route_key: entry.route_key,
          count: nextCount,
          last_seen_at: entry.last_seen_at || nowIso(),
        },
        { onConflict: 'method,route_key' },
      );
    if (upsertError) throw upsertError;
    entry.count = nextCount;
    return true;
  } catch (err) {
    console.warn('[route-hits] supabase upsert failed', err?.message || err);
    return false;
  }
}

async function flushToSupabase() {
  if (!isProd || flushing) return;
  flushing = true;
  const entries = Array.from(store.values()).filter((entry) => entry.pending > 0);
  for (const entry of entries) {
    const pending = entry.pending;
    const ok = await upsertRouteHit(entry, pending);
    if (ok) entry.pending = 0;
  }
  flushing = false;
}

function startFlusher() {
  if (intervalId) return;
  if (!isProd) loadLocalStore();
  intervalId = setInterval(() => {
    if (isProd) {
      flushToSupabase().catch(() => {});
    } else {
      writeLocalStore();
    }
  }, flushMs);
  intervalId.unref?.();
  const flushOnExit = async () => {
    if (isProd) {
      await flushToSupabase();
    } else {
      writeLocalStore();
    }
  };
  process.once('SIGTERM', flushOnExit);
  process.once('SIGINT', flushOnExit);
}

function recordHit({ method, routeKey }) {
  if (!method || !routeKey) return null;
  startFlusher();
  const key = `${method} ${routeKey}`;
  const entry = store.get(key) || {
    key,
    method,
    route_key: routeKey,
    count: 0,
    last_seen_at: null,
    pending: 0,
  };
  entry.count += 1;
  entry.pending += 1;
  entry.last_seen_at = nowIso();
  store.set(key, entry);
  return entry;
}

function bumpRouteHit(method, routeKey) {
  return recordHit({ method, routeKey });
}

function getRouteHitEntry(method, routeKey) {
  const key = `${method} ${routeKey}`;
  return store.get(key) || null;
}

module.exports = {
  recordHit,
  bumpRouteHit,
  getRouteHitEntry,
  serializeStore,
  loadLocalStore,
  writeLocalStore,
  flushToSupabase,
  startFlusher,
};
