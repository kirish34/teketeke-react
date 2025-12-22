const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../supabase');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

// Require SYSTEM_ADMIN before accessing registry routes
async function requireSystemAdmin(req, res, next) {
  if (!supabaseAdmin) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  return requireUser(req, res, async () => {
    try {
      const uid = req.user?.id;
      if (!uid) return res.status(401).json({ error: 'missing user' });
      const { data, error } = await supabaseAdmin
        .from('staff_profiles')
        .select('id')
        .eq('user_id', uid)
        .eq('role', 'SYSTEM_ADMIN')
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(403).json({ error: 'forbidden' });
      return next();
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
}

router.use(requireSystemAdmin);

const ROOT = process.cwd();
const REG_DIR = path.join(ROOT, 'data', 'registry');
const DEVICES_FILE = path.join(REG_DIR, 'devices.json');
const ASSIGN_FILE = path.join(REG_DIR, 'matatu_devices.json');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
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

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = 'dev') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// GET /api/registry/devices
router.get('/registry/devices', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('registry_devices')
    .select('*')
    .eq('domain', 'teketeke')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, items: data || [] });
});

// POST /api/registry/devices
router.post('/registry/devices', async (req, res) => {
  const { label, device_type, vendor, model, serial, imei, sim_msisdn, sim_iccid, notes } = req.body || {};
  if (!label || !device_type) return res.status(400).json({ ok: false, error: 'label and device_type are required' });

  const { data: dup, error: dupErr } = await supabaseAdmin
    .from('registry_devices')
    .select('id')
    .eq('domain', 'teketeke')
    .or(`imei.eq.${imei || ''},serial.eq.${serial || ''}`)
    .maybeSingle();
  if (dupErr) return res.status(500).json({ ok: false, error: dupErr.message });
  if (dup) return res.status(409).json({ ok: false, error: 'Device already exists (imei/serial duplicate)' });

  const { data, error } = await supabaseAdmin
    .from('registry_devices')
    .insert({
      domain: 'teketeke',
      label,
      device_type,
      vendor: vendor || null,
      model: model || null,
      serial: serial || null,
      imei: imei || null,
      sim_msisdn: sim_msisdn || null,
      sim_iccid: sim_iccid || null,
      status: 'offline',
      notes: notes || null,
    })
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, device: data });
});

// PATCH /api/registry/devices/:id
router.patch('/registry/devices/:id', async (req, res) => {
  const { id } = req.params;
  const payload = { ...req.body };
  delete payload.domain;
  const { data, error } = await supabaseAdmin
    .from('registry_devices')
    .update(payload)
    .eq('id', id)
    .eq('domain', 'teketeke')
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'Device not found' });
  return res.json({ ok: true, device: data });
});

// POST /api/registry/assign
router.post('/registry/assign', async (req, res) => {
  const { device_id, sacco_id, matatu_id, route_id } = req.body || {};
  if (!device_id || !sacco_id || !matatu_id) {
    return res.status(400).json({ ok: false, error: 'device_id, sacco_id, matatu_id required' });
  }

  const { data: dev, error: devErr } = await supabaseAdmin
    .from('registry_devices')
    .select('id')
    .eq('id', device_id)
    .eq('domain', 'teketeke')
    .maybeSingle();
  if (devErr) return res.status(500).json({ ok: false, error: devErr.message });
  if (!dev) return res.status(404).json({ ok: false, error: 'Device not found' });

  await supabaseAdmin
    .from('registry_assignments')
    .update({ active: false })
    .eq('device_id', device_id)
    .eq('domain', 'teketeke');

  const { data: assignment, error } = await supabaseAdmin
    .from('registry_assignments')
    .insert({
      domain: 'teketeke',
      device_id,
      sacco_id,
      matatu_id,
      route_id: route_id || null,
      active: true,
    })
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, assignment });
});

// GET /api/registry/assignments?sacco_id=
router.get('/registry/assignments', async (req, res) => {
  const { sacco_id } = req.query || {};
  let query = supabaseAdmin.from('registry_assignments').select('*').eq('domain', 'teketeke').order('assigned_at', { ascending: false });
  if (sacco_id) query = query.eq('sacco_id', sacco_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, items: data || [] });
});

module.exports = router;
