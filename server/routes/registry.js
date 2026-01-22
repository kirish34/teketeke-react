const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const { logAdminAction } = require('../services/audit.service');

const router = express.Router();

router.use(requireSystemOrSuper);

// GET /api/registry/devices
router.get('/devices', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('registry_devices')
    .select('*')
    .eq('domain', 'teketeke')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, items: data || [] });
});

// POST /api/registry/devices
router.post('/devices', async (req, res) => {
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
  await logAdminAction({
    req,
    action: 'registry_device_create',
    resource_type: 'registry_device',
    resource_id: data?.id || null,
    payload: { label, device_type },
  });
  return res.json({ ok: true, device: data });
});

// PATCH /api/registry/devices/:id
router.patch('/devices/:id', async (req, res) => {
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
  await logAdminAction({
    req,
    action: 'registry_device_update',
    resource_type: 'registry_device',
    resource_id: id,
    payload: { label: payload.label || null, device_type: payload.device_type || null },
  });
  return res.json({ ok: true, device: data });
});

// POST /api/registry/assign
router.post('/assign', async (req, res) => {
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
  await logAdminAction({
    req,
    action: 'registry_assignment_create',
    resource_type: 'registry_assignment',
    resource_id: assignment?.id || null,
    payload: { device_id, sacco_id, matatu_id, route_id },
  });
  return res.json({ ok: true, assignment });
});

// GET /api/registry/assignments?sacco_id=
router.get('/assignments', async (req, res) => {
  const { sacco_id } = req.query || {};
  let query = supabaseAdmin.from('registry_assignments').select('*').eq('domain', 'teketeke').order('assigned_at', { ascending: false });
  if (sacco_id) query = query.eq('sacco_id', sacco_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, items: data || [] });
});

module.exports = router;
