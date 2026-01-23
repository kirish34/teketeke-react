const pool = require('../db/pool');
const { logAdminAction } = require('./audit.service');

const memoryIdem = new Map();
const allowInit =
  process.env.ALLOW_CALLBACK_TABLE_INIT === '1' ||
  process.env.NODE_ENV === 'test';
let tableReady = false;

async function ensureIdempotencyTable(client = pool) {
  if (!allowInit) return;
  if (tableReady) return;
  if (!client?.query) return;
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS mpesa_callback_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz DEFAULT now(),
        domain text NOT NULL DEFAULT 'teketeke',
        kind text NOT NULL,
        idempotency_key text NOT NULL,
        status text NOT NULL DEFAULT 'processed',
        payload jsonb NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS mpesa_callback_events_uniq
        ON mpesa_callback_events(domain, kind, idempotency_key);
      CREATE INDEX IF NOT EXISTS mpesa_callback_events_created_desc
        ON mpesa_callback_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS mpesa_callback_events_kind_created_desc
        ON mpesa_callback_events(domain, kind, created_at DESC);
    `);
    tableReady = true;
  } catch (err) {
    console.warn('[callback-idem] table init failed:', err.message);
  }
}

async function ensureIdempotent({ kind, key, payload = null, client = null }) {
  if (!key) return { firstTime: true, store: 'none' };
  const mapKey = `${kind || 'callback'}:${key}`;

  if (process.env.NODE_ENV === 'test') {
    if (memoryIdem.has(mapKey)) return { firstTime: false, store: 'memory' };
    memoryIdem.set(mapKey, true);
    return { firstTime: true, store: 'memory' };
  }

  const db = client || pool;
  if (!db?.query) return { firstTime: true, store: 'none' };
  try {
    await ensureIdempotencyTable(db);
    const res = await db.query(
      `
        INSERT INTO mpesa_callback_events (domain, kind, idempotency_key, payload)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (domain, kind, idempotency_key) DO NOTHING
        RETURNING id
      `,
      ['teketeke', kind || 'callback', key, payload || null]
    );
    return { firstTime: res.rowCount > 0, store: 'db' };
  } catch (err) {
    console.warn('[callback-idem] insert failed:', err.message);
    if (process.env.NODE_ENV === 'test') {
      if (memoryIdem.has(mapKey)) return { firstTime: false, store: 'memory-fallback' };
      memoryIdem.set(mapKey, true);
      return { firstTime: true, store: 'memory-fallback' };
    }
    return { firstTime: true, store: 'error' };
  }
}

function validateRequired(payload = {}, required = []) {
  const missing = [];
  for (const field of required) {
    const value = payload[field];
    if (value === undefined || value === null || value === '') {
      missing.push(field);
    }
  }
  return { ok: missing.length === 0, missing };
}

function verifyShortcode({ received, expected }) {
  if (!expected) return { ok: true };
  const ok = String(received || '').trim() === String(expected).trim();
  return ok ? { ok: true } : { ok: false, reason: 'shortcode_mismatch' };
}

function safeAck(res, body = { ok: true }, status = 200) {
  try {
    return res.status(status).json(body);
  } catch (err) {
    try {
      res.status(status).send(typeof body === 'string' ? body : JSON.stringify(body));
    } catch (_) {
      // ignore send errors
    }
    return res;
  }
}

async function logCallbackAudit({ req, key, kind, result, reason = null, payload = null }) {
  try {
    await logAdminAction({
      req,
      action: 'mpesa_callback',
      resource_type: kind || 'callback',
      resource_id: key || null,
      payload: {
        result: result || null,
        reason: reason || null,
        key: key || null,
        ...(payload || {}),
      },
    });
  } catch (err) {
    console.warn('[callback-audit] log failed:', err.message);
  }
}

module.exports = {
  ensureIdempotent,
  validateRequired,
  verifyShortcode,
  safeAck,
  logCallbackAudit,
};
