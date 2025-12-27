const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { supabaseAdmin } = require('../supabase');

const router = express.Router();
const ROOT = process.cwd();
const REG_DIR = path.join(ROOT, 'data', 'registry');
const DEVICES_FILE = path.join(REG_DIR, 'devices.json');
const TELEMETRY_TOKEN = process.env.TELEMETRY_TOKEN || null;
const ENABLE_STORAGE = (process.env.TELEMETRY_ENABLE_STORAGE || 'true').toLowerCase() === 'true';

function ensureDir(p) {
  if (!ENABLE_STORAGE) return;
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function appendJsonl(file, obj) {
  if (!ENABLE_STORAGE) return;
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf-8');
}

function dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf-8');
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function updateDeviceLastSeen(deviceId, ts) {
  if (!ENABLE_STORAGE) return;
  if (!deviceId) return;
  const store = readJson(DEVICES_FILE, { items: [] });
  const idx = store.items.findIndex((d) => d.id === deviceId);
  if (idx === -1) return;
  store.items[idx] = { ...store.items[idx], last_seen_at: ts, status: 'online', updated_at: ts };
  writeJson(DEVICES_FILE, store);
}

function updateDeviceStatus(deviceId, ts) {
  if (!supabaseAdmin || !deviceId) return;
  supabaseAdmin
    .from('registry_devices')
    .update({ last_seen_at: ts, status: 'online' })
    .eq('id', deviceId)
    .eq('domain', 'teketeke')
    .then(({ error }) => {
      if (error) console.warn('[telemetry] registry update failed', error.message);
    })
    .catch((err) => console.warn('[telemetry] registry update failed', err.message));
}

function ensureTelemetryAuth(req, res, next) {
  if (!TELEMETRY_TOKEN) return res.status(503).json({ ok: false, error: 'telemetry disabled: missing TELEMETRY_TOKEN' });
  const got = req.headers['x-telemetry-key'] || '';
  if (got !== TELEMETRY_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  return next();
}

// Heartbeat from device (requires shared key)
router.post('/device/heartbeat', ensureTelemetryAuth, (req, res) => {
  const body = req.body || {};
  const ts = new Date().toISOString();
  const day = dateKey();
  const file = path.join(ROOT, 'data', 'heartbeats', `${day}.jsonl`);

  const record = {
    event_type: 'device_heartbeat',
    ts,
    device_id: body.device_id || null,
    sacco_id: body.sacco_id || null,
    matatu_id: body.matatu_id || null,
    meta: {
      ip: body.ip || null,
      signal: body.signal || null,
      voltage: body.voltage || null,
      temp: body.temp || null,
      wifi_clients: body.wifi_clients || null,
      firmware: body.firmware || null,
    },
    event_key: sha1(`${body.device_id || 'na'}|${Math.floor(Date.now() / 60000)}`),
  };

  appendJsonl(file, record);
  updateDeviceLastSeen(body.device_id, ts);
  updateDeviceStatus(body.device_id, ts);

  if (supabaseAdmin) {
    supabaseAdmin
      .from('device_heartbeats')
      .insert({
        domain: 'teketeke',
        device_id: body.device_id || null,
        sacco_id: body.sacco_id || null,
        matatu_id: body.matatu_id || null,
        route_id: body.route_id || null,
        ts,
        meta: record.meta,
      })
      .then(() => {})
      .catch((err) => console.warn('[telemetry] heartbeat insert failed', err.message));
  }

  return res.json({ ok: true });
});

// Telemetry burst (gps/speed/ignition/passenger_count) - requires shared key
router.post('/device/telemetry', ensureTelemetryAuth, (req, res) => {
  const body = req.body || {};
  const ts = new Date().toISOString();
  const day = dateKey();
  const file = path.join(ROOT, 'data', 'telemetry', `${day}.jsonl`);

  if (!body.device_id) return res.status(400).json({ ok: false, error: 'device_id required' });

  const record = {
    event_type: 'device_telemetry',
    ts,
    device_id: body.device_id,
    sacco_id: body.sacco_id || null,
    matatu_id: body.matatu_id || null,
    route_id: body.route_id || null,
    meta: {
      lat: body.lat ?? null,
      lon: body.lon ?? null,
      speed_kph: body.speed_kph ?? null,
      heading: body.heading ?? null,
      ignition: body.ignition ?? null,
      passenger_count: body.passenger_count ?? null,
      door_open: body.door_open ?? null,
      engine_temp: body.engine_temp ?? null,
      fuel_est: body.fuel_est ?? null,
    },
    event_key: sha1(`${body.device_id}|${ts}|${body.lat ?? 'x'}|${body.lon ?? 'x'}`),
  };

  appendJsonl(file, record);
  updateDeviceStatus(body.device_id, ts);
  if (supabaseAdmin) {
    supabaseAdmin
      .from('device_telemetry')
      .insert({
        domain: 'teketeke',
        device_id: body.device_id || null,
        sacco_id: body.sacco_id || null,
        matatu_id: body.matatu_id || null,
        route_id: body.route_id || null,
        ts,
        lat: body.lat ?? null,
        lon: body.lon ?? null,
        speed_kph: body.speed_kph ?? null,
        heading: body.heading ?? null,
        ignition: body.ignition ?? null,
        passenger_count: body.passenger_count ?? null,
        meta: record.meta,
      })
      .then(() => {})
      .catch((err) => console.warn('[telemetry] telemetry insert failed', err.message));
  }

  return res.json({ ok: true });
});

module.exports = router;
