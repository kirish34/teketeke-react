const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { upsertAppUserContext, normalizeEffectiveRole } = require('../services/appUserContext.service');
const { registerWalletForEntity } = require('../wallet/wallet.service');
const { ensurePaybillAlias } = require('../wallet/wallet.aliases');

const router = express.Router();

if (!supabaseAdmin) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for signup routes');
}

async function ensureAuthUser(email, password) {
  const createRes = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createRes.error) {
    const msg = String(createRes.error.message || createRes.error);
    if (!/already/i.test(msg) && !/exists/i.test(msg) && !/registered/i.test(msg)) {
      throw createRes.error;
    }

    let page = 1;
    while (page <= 50) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      if (!data?.users?.length) break;
      const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
      if (found) return found.id;
      page += 1;
    }

    throw new Error('Supabase user ' + email + ' exists but could not be retrieved');
  }

  const userId = createRes.data?.user?.id;
  if (!userId) throw new Error('Failed to resolve created user id');
  return userId;
}

async function ensureNoExistingRole(userId) {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data && data.role) {
    throw new Error('This email already has a ' + data.role + ' login. Please sign in instead.');
  }
}

async function upsertUserRole({ user_id, role, sacco_id = null, matatu_id = null }) {
  const normalizeRole = (r) => (r === 'DRIVER' || r === 'MATATU_STAFF' ? 'STAFF' : r);
  const nextRole = normalizeRole(role);

  const { error } = await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id, role: nextRole, sacco_id, matatu_id }, { onConflict: 'user_id' });

  if (error) throw error;
}

async function ensureMatatu({ vehicleType, numberPlate, ownerName, ownerPhone, saccoId, tillNumber }) {
  const plate = (numberPlate || '').toString().trim().toUpperCase();
  if (!plate) throw new Error('number_plate required');

  const type = (vehicleType || '').toString().trim().toUpperCase();

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('matatus')
    .select('id, vehicle_type')
    .eq('number_plate', plate)
    .maybeSingle();

  if (existingErr) throw existingErr;

  if (existing && existing.vehicle_type && existing.vehicle_type !== type) {
    throw new Error('This plate is already registered as ' + existing.vehicle_type);
  }

  if (existing) return existing.id;

  const row = {
    sacco_id: saccoId || null,
    number_plate: plate,
    owner_name: ownerName || null,
    owner_phone: ownerPhone || null,
    vehicle_type: type,
    tlb_number: null,
    till_number: tillNumber || null,
  };

  const { data, error } = await supabaseAdmin
    .from('matatus')
    .insert(row)
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

function validateSignupBody(body) {
  const name = (body?.name || '').toString().trim();
  const email = (body?.email || '').toString().trim().toLowerCase();
  const password = (body?.password || '').toString();
  const phone = (body?.phone || '').toString().trim();
  const plate = (body?.plate || '').toString().trim().toUpperCase();
  const till = (body?.till_number || '').toString().trim() || null;

  if (!name) return { error: 'Name is required' };
  if (!email || !email.includes('@')) return { error: 'Valid email is required' };
  if (!password || password.length < 6) return { error: 'Password must be at least 6 characters' };
  if (!plate) return { error: 'Vehicle plate is required' };

  return {
    value: {
      name,
      email,
      password,
      phone,
      plate,
      till,
    },
  };
}

router.post('/taxi', async (req, res) => {
  const { value, error: validationError } = validateSignupBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const userId = await ensureAuthUser(value.email, value.password);
    await ensureNoExistingRole(userId);

    const matatuId = await ensureMatatu({
      vehicleType: 'TAXI',
      numberPlate: value.plate,
      ownerName: value.name,
      ownerPhone: value.phone,
      saccoId: null,
      tillNumber: value.till,
    });

    // Create driver wallet + account code for taxi signups
    let walletId = null;
    let paybillCode = null;
    try {
      const wallet = await registerWalletForEntity({
        entityType: 'TAXI',
        entityId: matatuId,
        walletKind: 'TAXI_DRIVER',
        numericRef: Date.now() % 100000,
      });
      walletId = wallet?.id || null;
      if (walletId) {
        paybillCode = await ensurePaybillAlias({ walletId, key: '40' }).catch(() => null);
      }
    } catch (err) {
      // Continue even if wallet creation fails; front-end can retry via admin flow
      console.error('taxi signup wallet create failed:', err.message);
    }

    await upsertUserRole({
      user_id: userId,
      role: 'TAXI',
      sacco_id: null,
      matatu_id: matatuId,
    });
    await upsertAppUserContext({
      user_id: userId,
      email: value.email,
      effective_role: normalizeEffectiveRole('TAXI'),
      sacco_id: null,
      matatu_id: matatuId,
    });

    res.json({ ok: true, user_id: userId, matatu_id: matatuId, role: 'TAXI', wallet_id: walletId, paybill_code: paybillCode });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to create taxi account' });
  }
});

router.post('/boda', async (req, res) => {
  const { value, error: validationError } = validateSignupBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const userId = await ensureAuthUser(value.email, value.password);
    await ensureNoExistingRole(userId);

    const matatuId = await ensureMatatu({
      vehicleType: 'BODABODA',
      numberPlate: value.plate,
      ownerName: value.name,
      ownerPhone: value.phone,
      saccoId: null,
      tillNumber: value.till,
    });

    await upsertUserRole({
      user_id: userId,
      role: 'BODA',
      sacco_id: null,
      matatu_id: matatuId,
    });
    await upsertAppUserContext({
      user_id: userId,
      email: value.email,
      effective_role: normalizeEffectiveRole('BODA'),
      sacco_id: null,
      matatu_id: matatuId,
    });

    res.json({ ok: true, user_id: userId, matatu_id: matatuId, role: 'BODA' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to create boda account' });
  }
});

module.exports = router;
