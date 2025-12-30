const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../supabase');
const pool = require('../db/pool');
const { creditFareWithFees, creditWallet, registerWalletForEntity } = require('../wallet/wallet.service');
const { requireUser } = require('../middleware/auth');
const router = express.Router();

// Require a signed-in Supabase user with role SYSTEM_ADMIN
async function requireSystemAdmin(req, res, next){
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'SERVICE_ROLE not configured on server (SUPABASE_SERVICE_ROLE_KEY)' });
  }
  return requireUser(req, res, async () => {
    try{
      const uid = req.user?.id;
      if (!uid) return res.status(401).json({ error: 'missing user' });
      const { data, error } = await supabaseAdmin
        .from('staff_profiles')
        .select('id')
        .eq('user_id', uid)
        .eq('role', 'SYSTEM_ADMIN')
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (data) return next();
      return res.status(403).json({ error: 'forbidden' });
    }catch(e){ return res.status(500).json({ error: e.message }); }
  });
}

router.use(requireSystemAdmin);

function parseDateRange(query = {}) {
  const range = (query.range || '').toLowerCase();
  const now = new Date();
  let from;
  let to;

  const toParam = query.to ? new Date(query.to) : null;
  const fromParam = query.from ? new Date(query.from) : null;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  if (range === 'today') {
    from = todayStart;
    to = todayEnd;
  } else if (range === 'week') {
    const day = now.getDay(); // 0 = Sun, 1 = Mon
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    from = monday;
    to = todayEnd;
  } else if (range === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    first.setHours(0, 0, 0, 0);
    from = first;
    to = todayEnd;
  } else {
    from = fromParam && !Number.isNaN(fromParam.getTime()) ? fromParam : todayStart;
    to = toParam && !Number.isNaN(toParam.getTime()) ? toParam : todayEnd;
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function normalizeDateBounds(fromRaw, toRaw) {
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const dateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (from && Number.isNaN(from.getTime())) return { from: null, to: null };
  if (to && Number.isNaN(to.getTime())) return { from: null, to: null };

  if (from && dateOnly(fromRaw)) from.setHours(0, 0, 0, 0);
  if (to && dateOnly(toRaw)) to.setHours(23, 59, 59, 999);

  return { from, to };
}

function deriveNumericRef(...values) {
  for (const v of values) {
    if (!v) continue;
    const digits = String(v).match(/\d+/g);
    if (digits && digits.length) {
      const num = Number(digits.join('').slice(-6));
      if (num > 0) return num;
    }
  }
  return Date.now() % 100000;
}

// Simple ping for UI testing
router.get('/ping', (_req,res)=> res.json({ ok:true }));

// Overview
router.get('/system-overview', async (_req, res) => {
  try {
    const [
      { count: saccos },
      { count: matatus },
      { count: taxis },
      { count: bodas },
      { count: staff },
      { data: txTodayRows },
    ] = await Promise.all([
      supabaseAdmin.from('saccos').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('matatus')
        .select('*', { count: 'exact', head: true })
        .or('vehicle_type.eq.MATATU,vehicle_type.is.null'),
      supabaseAdmin
        .from('matatus')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_type', 'TAXI'),
      supabaseAdmin
        .from('matatus')
        .select('*', { count: 'exact', head: true })
        .or('vehicle_type.eq.BODABODA,vehicle_type.eq.BODA'),
      supabaseAdmin.from('staff_profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin.rpc('count_tx_today'),
    ]);
    const { data: poolAvail } = await supabaseAdmin.from('ussd_pool').select('id').eq('status','AVAILABLE');
    const { data: poolAll }   = await supabaseAdmin.from('ussd_pool').select('id', { count: 'exact' });
    res.json({
      counts: {
        saccos: saccos || 0,
        matatus: matatus || 0,
        taxis: taxis || 0,
        bodas: bodas || 0,
        cashiers: staff || 0,
        tx_today: txTodayRows || 0,
      },
      ussd_pool: {
        available: (poolAvail || []).length,
        total: poolAll?.length || 0,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual wallet credit (admin adjustment)
router.post('/wallets/credit', async (req, res) => {
  try {
    const {
      virtualAccountCode,
      amount,
      source,
      sourceRef,
      description,
    } = req.body || {};
    const result = await creditWallet({
      virtualAccountCode,
      amount,
      source: source || 'ADMIN_ADJUST',
      sourceRef: sourceRef || null,
      description: description || null,
    });
    res.json({ ok: true, message: 'Wallet credited', data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Credit failed' });
  }
});

// Platform finance overview (all saccos)
router.get('/platform-overview', async (req, res) => {
  const range = parseDateRange(req.query);
  try {
    const { rows } = await pool.query(
      `
        SELECT
          COALESCE((
            SELECT SUM(amount) FROM wallet_transactions
            WHERE tx_type = 'CREDIT' AND source = 'MPESA_C2B'
              AND created_at BETWEEN $1 AND $2
          ), 0) AS matatu_net,
          COALESCE((
            SELECT SUM(wt.amount) FROM wallet_transactions wt
            JOIN wallets w ON w.id = wt.wallet_id
            WHERE wt.tx_type = 'CREDIT' AND wt.source = 'FEE_MATATU_FARE'
              AND w.entity_type = 'SACCO'
              AND wt.created_at BETWEEN $1 AND $2
          ), 0) AS sacco_fee_income,
          COALESCE((
            SELECT SUM(wt.amount) FROM wallet_transactions wt
            JOIN wallets w ON w.id = wt.wallet_id
            WHERE wt.tx_type = 'CREDIT' AND wt.source = 'FEE_MATATU_FARE'
              AND w.entity_type = 'SYSTEM'
              AND wt.created_at BETWEEN $1 AND $2
          ), 0) AS platform_fee_income
      `,
      [range.from, range.to]
    );

    const row = rows[0] || {};
    const matatu_net = Number(row.matatu_net || 0);
    const sacco_fee_income = Number(row.sacco_fee_income || 0);
    const platform_fee_income = Number(row.platform_fee_income || 0);
    const gross_fares = matatu_net + sacco_fee_income + platform_fee_income;

    res.json({
      period: range,
      totals: {
        gross_fares,
        matatu_net,
        sacco_fee_income,
        platform_fee_income,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Platform sacco performance summary
router.get('/platform-saccos-summary', async (req, res) => {
  const range = parseDateRange(req.query);
  try {
    const { rows } = await pool.query(
      `
        WITH matatu_net AS (
          SELECT
            m.sacco_id,
            COUNT(DISTINCT m.id) AS matatus,
            COALESCE(SUM(wt.amount), 0) AS matatu_net
          FROM matatus m
          LEFT JOIN wallets w ON w.entity_type = 'MATATU' AND w.entity_id = m.id
          LEFT JOIN wallet_transactions wt
            ON wt.wallet_id = w.id
           AND wt.tx_type = 'CREDIT'
           AND wt.source = 'MPESA_C2B'
           AND wt.created_at BETWEEN $1 AND $2
          GROUP BY m.sacco_id
        ),
        sacco_fees AS (
          SELECT
            w.entity_id AS sacco_id,
            COALESCE(SUM(wt.amount), 0) AS sacco_fee_income
          FROM wallets w
          LEFT JOIN wallet_transactions wt
            ON wt.wallet_id = w.id
           AND wt.tx_type = 'CREDIT'
           AND wt.source = 'FEE_MATATU_FARE'
           AND wt.created_at BETWEEN $1 AND $2
          WHERE w.entity_type = 'SACCO'
          GROUP BY w.entity_id
        )
        SELECT
          s.id AS sacco_id,
          s.name AS sacco_name,
          COALESCE(mn.matatus, 0)::int AS matatus,
          COALESCE(mn.matatu_net, 0) AS matatu_net,
          COALESCE(sf.sacco_fee_income, 0) AS sacco_fee_income,
          (COALESCE(mn.matatu_net, 0) + COALESCE(sf.sacco_fee_income, 0)) AS gross_fares,
          'ACTIVE' AS status
        FROM saccos s
        LEFT JOIN matatu_net mn ON mn.sacco_id = s.id
        LEFT JOIN sacco_fees sf ON sf.sacco_id = s.id
        ORDER BY gross_fares DESC, sacco_name ASC
      `,
      [range.from, range.to]
    );

    res.json({
      period: range,
      items: rows || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Withdrawals monitor
router.get('/withdrawals', async (req, res) => {
  const range = parseDateRange(req.query);
  const status = req.query.status || null;
  try {
    const params = [range.from, range.to];
    let statusClause = '';
    if (status) {
      statusClause = 'AND w.status = $3';
      params.push(status);
    }

    const { rows } = await pool.query(
      `
        SELECT
          w.id,
          w.created_at,
          w.amount,
          w.phone_number,
          w.status,
          w.failure_reason,
          w.mpesa_transaction_id,
          w.mpesa_conversation_id,
          wal.virtual_account_code,
          wal.entity_type,
          wal.entity_id
        FROM withdrawals w
        JOIN wallets wal ON wal.id = w.wallet_id
        WHERE w.created_at BETWEEN $1 AND $2
        ${statusClause}
        ORDER BY w.created_at DESC
        LIMIT 200
      `,
      params
    );

    res.json({
      period: range,
      items: rows || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// C2B payments log
router.get('/c2b-payments', async (req, res) => {
  const status = String(req.query.status || '').toLowerCase();
  const q = String(req.query.q || '').trim();
  const { from, to } = normalizeDateBounds(req.query.from, req.query.to);
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offsetRaw = Number(req.query.offset);
  const pageRaw = Number(req.query.page);
  let offset = 0;
  if (Number.isFinite(offsetRaw) && offsetRaw >= 0) {
    offset = offsetRaw;
  } else if (Number.isFinite(pageRaw) && pageRaw > 1) {
    offset = (pageRaw - 1) * limit;
  }

  const params = [];
  const where = [];
  if (status === 'processed') where.push('processed = true');
  if (status === 'pending') where.push('(processed = false OR processed IS NULL)');
  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    where.push(
      `(mpesa_receipt ILIKE $${idx} OR phone_number ILIKE $${idx} OR account_reference ILIKE $${idx} OR paybill_number ILIKE $${idx})`
    );
  }
  if (from) {
    params.push(from.toISOString());
    where.push(`transaction_timestamp >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`transaction_timestamp <= $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const countRes = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM paybill_payments_raw
        ${whereClause}
      `,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);
    const { rows } = await pool.query(
      `
        SELECT
          id,
          mpesa_receipt,
          phone_number,
          amount,
          paybill_number,
          account_reference,
          transaction_timestamp,
          processed,
          processed_at
        FROM paybill_payments_raw
        ${whereClause}
        ORDER BY transaction_timestamp DESC NULLS LAST, id DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params
    );
    res.json({ ok: true, items: rows || [], total, limit, offset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Fetch raw C2B payload
router.get('/c2b-payments/:id/raw', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rows } = await pool.query(
      `
        SELECT raw_payload
        FROM paybill_payments_raw
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, payload: rows[0].raw_payload });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Reprocess a C2B payment
router.post('/c2b-payments/:id/reprocess', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rows } = await pool.query(
      `
        SELECT
          id,
          mpesa_receipt,
          phone_number,
          amount,
          account_reference,
          processed
        FROM paybill_payments_raw
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    const row = rows[0];
    if (row.processed) {
      return res.status(400).json({ ok: false, error: 'already processed' });
    }
    if (!row.account_reference) {
      return res.status(400).json({ ok: false, error: 'missing account reference' });
    }
    const amount = Number(row.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid amount' });
    }

    const sourceRef = row.mpesa_receipt || String(row.id);
    const existing = await pool.query(
      `
        SELECT id
        FROM wallet_transactions
        WHERE source = 'MPESA_C2B' AND source_ref = $1
        LIMIT 1
      `,
      [sourceRef]
    );
    if (existing.rows.length) {
      await pool.query(
        `UPDATE paybill_payments_raw SET processed = true, processed_at = now() WHERE id = $1`,
        [row.id]
      );
      return res.json({ ok: true, message: 'Already credited; marked processed' });
    }

    const result = await creditFareWithFees({
      virtualAccountCode: row.account_reference,
      amount,
      source: 'MPESA_C2B',
      sourceRef,
      description: `M-Pesa fare from ${row.phone_number || 'unknown'}`,
    });

    await pool.query(
      `UPDATE paybill_payments_raw SET processed = true, processed_at = now() WHERE id = $1`,
      [row.id]
    );
    return res.json({ ok: true, message: 'Reprocessed', data: result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Saccos
router.get('/saccos', async (req,res)=>{
  let q = supabaseAdmin.from('saccos').select('*').order('created_at',{ascending:false});
  const filter = (req.query.q||'').trim();
  if (filter) q = q.ilike('name', `%${filter}%`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
async function ensureAuthUser(email, password){
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
      if (found) return { userId: found.id, created: false };
      page += 1;
    }
    throw new Error('Supabase user ' + email + ' exists but could not be retrieved');
  }
  const userId = createRes.data?.user?.id;
  if (!userId) throw new Error('Failed to resolve created user id');
  return { userId, created: true };
}

function normalizeOperatorType(value){
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'MATATU_SACCO' || raw === 'MATATU_COMPANY' || raw === 'BODA_GROUP' || raw === 'TAXI_FLEET') {
    return raw;
  }
  if (raw === 'SACCO' || raw === 'MATATU') return 'MATATU_SACCO';
  if (raw === 'BODA' || raw === 'BODABODA') return 'BODA_GROUP';
  if (raw === 'TAXI') return 'TAXI_FLEET';
  return 'MATATU_SACCO';
}

function defaultFeeLabelForType(operatorType){
  if (operatorType === 'BODA_GROUP') return 'Stage Fee';
  if (operatorType === 'TAXI_FLEET') return 'Dispatch Fee';
  return 'Daily Fee';
}

function parseBooleanFlag(value, fallback){
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'yes') return true;
    if (raw === 'false' || raw === '0' || raw === 'no') return false;
  }
  return fallback;
}

function generateTempPassword(){
  return `OP${crypto.randomBytes(6).toString('hex')}`;
}

async function upsertUserRole({ user_id, role, sacco_id = null, matatu_id = null }){
  const normalizeRole = (r) => {
    const upper = String(r || '').trim().toUpperCase();
    if (upper === 'DRIVER' || upper === 'MATATU_STAFF') return 'STAFF';
    if (upper === 'OPERATOR_ADMIN') return 'SACCO'; // TODO: adopt OPERATOR_ADMIN when backend roles expand.
    return upper;
  };
  role = normalizeRole(role);
  const { error } = await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id, role, sacco_id, matatu_id }, { onConflict: 'user_id' });
  if (error) throw error;
}

router.post('/register-sacco', async (req,res)=>{
  const displayName = String(req.body?.display_name || req.body?.name || '').trim();
  const operatorType = normalizeOperatorType(req.body?.operator_type || req.body?.org_type || req.body?.operatorType || req.body?.type);
  const feeLabelDefault = defaultFeeLabelForType(operatorType);
  const routesDefault = operatorType === 'MATATU_SACCO' || operatorType === 'MATATU_COMPANY';
  const statusRaw = String(req.body?.status || 'ACTIVE').trim().toUpperCase();
  const row = {
    name: displayName || null,
    display_name: displayName || null,
    operator_type: operatorType,
    org_type: operatorType,
    legal_name: String(req.body?.legal_name || '').trim() || null,
    registration_no: String(req.body?.registration_no || '').trim() || null,
    status: statusRaw === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
    contact_name: String(req.body?.contact_name || '').trim() || null,
    contact_account_number: String(req.body?.contact_account_number || '').trim() || null,
    contact_phone: String(req.body?.contact_phone || '').trim() || null,
    contact_email: String(req.body?.contact_email || '').trim() || null,
    default_till: String(req.body?.default_till || '').trim() || null,
    settlement_bank_name: String(req.body?.settlement_bank_name || '').trim() || null,
    settlement_bank_account_number: String(req.body?.settlement_bank_account_number || '').trim() || null,
    fee_label: String(req.body?.fee_label || '').trim() || feeLabelDefault,
    savings_enabled: parseBooleanFlag(req.body?.savings_enabled, true),
    loans_enabled: parseBooleanFlag(req.body?.loans_enabled, true),
    routes_enabled: parseBooleanFlag(req.body?.routes_enabled, routesDefault),
  };
  if (!row.name) return res.status(400).json({ error:'display_name required' });

  const loginEmail = String(req.body?.admin_email || req.body?.login_email || '').trim();
  const loginPhone = String(req.body?.admin_phone || '').trim();
  let loginPassword = req.body?.admin_password || req.body?.login_password || '';
  if (!loginEmail && loginPassword) {
    return res.status(400).json({ error:'login_email required when password is provided' });
  }
  let generatedPassword = '';
  if (loginEmail && !loginPassword) {
    generatedPassword = generateTempPassword();
    loginPassword = generatedPassword;
  }

  const { data, error } = await supabaseAdmin.from('saccos').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const result = { ...data };
  if (loginEmail && loginPassword){
    try{
      const { userId, created } = await ensureAuthUser(loginEmail, loginPassword);
      await upsertUserRole({ user_id: userId, role: 'SACCO', sacco_id: data.id });
      result.created_user = { email: loginEmail, role: 'SACCO' };
      if (created && generatedPassword) {
        result.created_user.temp_password = generatedPassword;
      }
      if (!created) {
        result.created_user.note = 'User existed; password not reset';
      }
      if (loginPhone) {
        try {
          const { error: staffErr } = await supabaseAdmin
            .from('staff_profiles')
            .insert({
              user_id: userId,
              sacco_id: data.id,
              role: 'SACCO_ADMIN',
              name: displayName ? `${displayName} Admin` : 'Operator Admin',
              phone: loginPhone,
              email: loginEmail,
            });
          if (staffErr) {
            result.staff_profile_error = staffErr.message;
          }
        } catch (staffErr) {
          result.staff_profile_error = staffErr?.message || 'Failed to save admin profile';
        }
      }
    }catch(e){
      result.login_error = e.message || 'Failed to create operator login';
    }
  }
  try{
    const wallet = await registerWalletForEntity({
      entityType: 'SACCO',
      entityId: result.id,
      numericRef: deriveNumericRef(result.default_till, result.id)
    });
    result.wallet_id = wallet.id;
    result.virtual_account_code = wallet.virtual_account_code;
  }catch(e){
    return res.status(500).json({ error: 'SACCO created but wallet failed: ' + e.message });
  }
  res.json(result);
});
router.post('/update-sacco', async (req,res)=>{
  const { id, ...rest } = req.body||{};
  if(!id) return res.status(400).json({error:'id required'});
  if (rest.operator_type) {
    rest.operator_type = normalizeOperatorType(rest.operator_type);
    if (!rest.org_type) rest.org_type = rest.operator_type;
  }
  if (rest.status) {
    const nextStatus = String(rest.status).trim().toUpperCase();
    rest.status = nextStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
  }
  const { data, error } = await supabaseAdmin.from('saccos').update(rest).eq('id',id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
router.delete('/delete-sacco/:id', async (req,res)=>{
  const { error } = await supabaseAdmin.from('saccos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: 1 });
});

// Matatus
router.get('/matatus', async (req,res)=>{
  let q = supabaseAdmin.from('matatus').select('*').order('created_at',{ascending:false});
  if (req.query.sacco_id) q = q.eq('sacco_id', req.query.sacco_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/register-matatu', async (req,res)=>{
  const vehicleType = (req.body?.vehicle_type || 'MATATU').toString().toUpperCase();
  const saccoRaw = req.body?.sacco_id;
  const saccoId = typeof saccoRaw === 'string' ? saccoRaw.trim() : saccoRaw;
  const row = {
    sacco_id: saccoId || null,
    number_plate: (req.body?.number_plate||'').toUpperCase(),
    owner_name: req.body?.owner_name,
    owner_phone: req.body?.owner_phone,
    vehicle_type: vehicleType,
    tlb_number: req.body?.tlb_number,
    till_number: req.body?.till_number
  };
  if(!row.number_plate) return res.status(400).json({error:'number_plate required'});
  const needsSacco = vehicleType !== 'TAXI' && vehicleType !== 'BODABODA';
  if (needsSacco && !row.sacco_id) return res.status(400).json({error:`sacco_id required for ${vehicleType}`});
  const { data, error } = await supabaseAdmin.from('matatus').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  try{
    const wallet = await registerWalletForEntity({
      entityType: vehicleType === 'MATATU' ? 'MATATU' : vehicleType,
      entityId: data.id,
      numericRef: deriveNumericRef(data.number_plate, data.tlb_number, data.id)
    });
    res.json({
      ...data,
      wallet_id: wallet.id,
      virtual_account_code: wallet.virtual_account_code,
    });
  }catch(e){
    res.status(500).json({ error: 'Matatu created but wallet failed: ' + e.message });
  }
});
router.post('/update-matatu', async (req,res)=>{
  const { id, ...rest } = req.body||{};
  if(!id) return res.status(400).json({error:'id required'});
  if (rest.number_plate) rest.number_plate = String(rest.number_plate).toUpperCase();
  const { data, error } = await supabaseAdmin.from('matatus').update(rest).eq('id',id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
router.delete('/delete-matatu/:id', async (req,res)=>{
  const { error } = await supabaseAdmin.from('matatus').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: 1 });
});

// Shuttles
router.get('/shuttles', async (req,res)=>{
  // TODO: Switch operator join to an operators table if/when it replaces saccos.
  let q = supabaseAdmin
    .from('shuttles')
    .select('*, owner:owner_id(*), operator:operator_id(id, display_name, name, sacco_name)')
    .order('created_at',{ascending:false});
  if (req.query.operator_id) q = q.eq('operator_id', req.query.operator_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/register-shuttle', async (req,res)=>{
  const owner = req.body?.owner || {};
  const shuttle = req.body?.shuttle || {};
  const ownerRow = {
    full_name: String(owner.full_name || '').trim(),
    id_number: String(owner.id_number || '').trim(),
    kra_pin: owner.kra_pin ? String(owner.kra_pin).trim() : null,
    phone: owner.phone ? String(owner.phone).trim() : '',
    email: owner.email ? String(owner.email).trim() : null,
    address: owner.address ? String(owner.address).trim() : null,
    occupation: owner.occupation ? String(owner.occupation).trim() : null,
    location: owner.location ? String(owner.location).trim() : null,
    date_of_birth: owner.date_of_birth || null,
  };
  if (!ownerRow.full_name) return res.status(400).json({ error: 'owner full_name required' });
  if (!ownerRow.id_number) return res.status(400).json({ error: 'owner id_number required' });
  if (!ownerRow.phone) return res.status(400).json({ error: 'owner phone required' });

  const plate = String(shuttle.plate || '').trim().toUpperCase();
  const operatorId = shuttle.operator_id || null;
  const tillNumber = String(shuttle.till_number || '').trim();
  if (!plate) return res.status(400).json({ error: 'plate required' });
  if (!operatorId) return res.status(400).json({ error: 'operator_id required' });
  if (!tillNumber) return res.status(400).json({ error: 'till_number required' });

  const rawYear = shuttle.year ? Number(shuttle.year) : null;
  const year = Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;

  const { data: ownerData, error: ownerError } = await supabaseAdmin
    .from('shuttle_owners')
    .insert(ownerRow)
    .select()
    .single();
  if (ownerError) return res.status(500).json({ error: ownerError.message });

  const shuttleRow = {
    plate,
    make: shuttle.make ? String(shuttle.make).trim() : null,
    model: shuttle.model ? String(shuttle.model).trim() : null,
    year,
    operator_id: operatorId,
    tlb_license: shuttle.tlb_license ? String(shuttle.tlb_license).trim() : null,
    till_number: tillNumber,
    owner_id: ownerData.id,
  };
  const { data, error } = await supabaseAdmin.from('shuttles').insert(shuttleRow).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, owner: ownerData });
});
router.post('/update-shuttle', async (req,res)=>{
  const { id, owner_id, owner, shuttle } = req.body||{};
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!owner_id) return res.status(400).json({ error: 'owner_id required' });

  const ownerPayload = owner || {};
  const ownerUpdate = {
    full_name: String(ownerPayload.full_name || '').trim(),
    id_number: String(ownerPayload.id_number || '').trim(),
    kra_pin: ownerPayload.kra_pin ? String(ownerPayload.kra_pin).trim() : null,
    phone: ownerPayload.phone ? String(ownerPayload.phone).trim() : '',
    email: ownerPayload.email ? String(ownerPayload.email).trim() : null,
    address: ownerPayload.address ? String(ownerPayload.address).trim() : null,
    occupation: ownerPayload.occupation ? String(ownerPayload.occupation).trim() : null,
    location: ownerPayload.location ? String(ownerPayload.location).trim() : null,
    date_of_birth: ownerPayload.date_of_birth || null,
  };
  if (!ownerUpdate.full_name) return res.status(400).json({ error: 'owner full_name required' });
  if (!ownerUpdate.id_number) return res.status(400).json({ error: 'owner id_number required' });
  if (!ownerUpdate.phone) return res.status(400).json({ error: 'owner phone required' });

  const shuttlePayload = shuttle || {};
  const plate = String(shuttlePayload.plate || '').trim().toUpperCase();
  const operatorId = shuttlePayload.operator_id || null;
  const tillNumber = String(shuttlePayload.till_number || '').trim();
  if (!plate) return res.status(400).json({ error: 'plate required' });
  if (!operatorId) return res.status(400).json({ error: 'operator_id required' });
  if (!tillNumber) return res.status(400).json({ error: 'till_number required' });

  const rawYear = shuttlePayload.year ? Number(shuttlePayload.year) : null;
  const year = Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;

  const { error: ownerError } = await supabaseAdmin
    .from('shuttle_owners')
    .update(ownerUpdate)
    .eq('id', owner_id);
  if (ownerError) return res.status(500).json({ error: ownerError.message });

  const shuttleUpdate = {
    plate,
    make: shuttlePayload.make ? String(shuttlePayload.make).trim() : null,
    model: shuttlePayload.model ? String(shuttlePayload.model).trim() : null,
    year,
    operator_id: operatorId,
    tlb_license: shuttlePayload.tlb_license ? String(shuttlePayload.tlb_license).trim() : null,
    till_number: tillNumber,
  };
  const { error: shuttleError } = await supabaseAdmin.from('shuttles').update(shuttleUpdate).eq('id', id);
  if (shuttleError) return res.status(500).json({ error: shuttleError.message });

  const { data, error } = await supabaseAdmin
    .from('shuttles')
    .select('*, owner:owner_id(*), operator:operator_id(id, display_name, name, sacco_name)')
    .eq('id', id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/user-roles/create-user', async (req,res)=>{
  const email = (req.body?.email || '').trim();
  const password = req.body?.password || '';
  const role = (req.body?.role || '').toUpperCase();
  const saccoId = req.body?.sacco_id || null;
  const matatuId = req.body?.matatu_id || null;

  if (!email) return res.status(400).json({ error:'email required' });
  if (!password) return res.status(400).json({ error:'password required' });
  if (!role) return res.status(400).json({ error:'role required' });

  const needsSacco = ['SACCO','SACCO_STAFF'].includes(role);
  const needsMatatu = ['OWNER','STAFF','TAXI','BODA'].includes(role);
  if (needsSacco && !saccoId) return res.status(400).json({ error:'sacco_id required for role ' + role });
  if (needsMatatu && !matatuId) return res.status(400).json({ error:'matatu_id required for role ' + role });

  try{
    const { userId } = await ensureAuthUser(email, password);
    await upsertUserRole({ user_id: userId, role, sacco_id: saccoId, matatu_id: matatuId });
    res.json({ user_id: userId, role, sacco_id: saccoId, matatu_id: matatuId });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to create role user' });
  }
});

router.get('/user-roles/logins', async (_req,res)=>{
  try{
    const { data, error } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role, sacco_id, matatu_id, created_at')
      .order('created_at', { ascending:false })
      .limit(50);
    if (error) throw error;
    if (!data || !data.length) return res.json([]);

    const enriched = await Promise.all(data.map(async (row) => {
      let email = null;
      if (row.user_id){
        try{
          const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
          if (!userErr) email = userData?.user?.email || null;
        }catch(_){ /* ignore */ }
      }
      return { ...row, email };
    }));

    res.json(enriched);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load logins' });
  }
});

router.post('/user-roles/update', async (req,res)=>{
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const update = {};
  const nextRole = req.body?.role ? String(req.body.role).toUpperCase() : null;
  const saccoId = req.body?.sacco_id ?? null;
  const matatuId = req.body?.matatu_id ?? null;

  if (nextRole){
    update.role = nextRole;
  }
  if ('sacco_id' in req.body) update.sacco_id = saccoId;
  if ('matatu_id' in req.body) update.matatu_id = matatuId;

  const needsSacco = ['SACCO'].includes(nextRole || '');
  const needsMatatu = ['OWNER','STAFF','TAXI','BODA'].includes(nextRole || '');
  if (needsSacco && !saccoId) return res.status(400).json({ error:'sacco_id required for role ' + nextRole });
  if (needsMatatu && !matatuId) return res.status(400).json({ error:'matatu_id required for role ' + nextRole });

  try{
    if (Object.keys(update).length){
      const { error } = await supabaseAdmin.from('user_roles').update(update).eq('user_id', userId);
      if (error) throw error;
    }

    const authUpdates = {};
    if (req.body?.email) authUpdates.email = req.body.email;
    if (req.body?.email) authUpdates.email_confirm = true;
    if (req.body?.password) authUpdates.password = req.body.password;
    if (Object.keys(authUpdates).length){
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, authUpdates);
      if (error) throw error;
    }

    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to update login' });
  }
});

router.delete('/user-roles/:user_id', async (req,res)=>{
  const userId = req.params.user_id;
  if (!userId) return res.status(400).json({ error:'user_id required' });
  const removeAuth = String(req.query.remove_user || '').toLowerCase() === 'true';
  try{
    const { error } = await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
    if (error) throw error;
    if (removeAuth){
      try{
        await supabaseAdmin.auth.admin.deleteUser(userId);
      }catch(_){ /* ignore */ }
    }
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to delete login' });
  }
});

// USSD Pool
function normalizeUssdPrefix(raw){
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '*001*';
  if (trimmed.endsWith('*')) return trimmed;
  return `${trimmed}*`;
}

function digitalRoot(value){
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return 1 + ((Math.floor(num) - 1) % 9);
}

function resolveUssdTierRange(tier){
  const key = String(tier || '').trim().toUpperCase();
  if (key === 'A') return { min: 1, max: 199 };
  if (key === 'B') return { min: 200, max: 699 };
  if (key === 'C') return { min: 700, max: 999 };
  return null;
}

function parseShortUssdEntry(entry, mode){
  const cleaned = String(entry || '').trim().replace(/\s+/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return { error: `invalid code: ${entry}` };

  const asBase = () => {
    const baseNum = Number(digits);
    if (!Number.isFinite(baseNum) || baseNum < 1 || baseNum > 999) {
      return { error: `base out of range: ${entry}` };
    }
    const checksum = digitalRoot(baseNum);
    if (checksum === null) return { error: `invalid base: ${entry}` };
    const base = String(baseNum);
    return { full_code: `${base}${checksum}`, base, checksum };
  };

  const asFull = () => {
    if (digits.length < 2) return { error: `invalid full code: ${entry}` };
    const base = digits.slice(0, -1);
    const check = digits.slice(-1);
    const baseNum = Number(base);
    if (!Number.isFinite(baseNum) || baseNum < 1 || baseNum > 999) {
      return { error: `base out of range: ${entry}` };
    }
    const expected = digitalRoot(baseNum);
    if (expected === null || String(expected) !== check) {
      return { error: `checksum mismatch: ${entry}` };
    }
    return { full_code: digits, base: String(baseNum), checksum: expected };
  };

  if (mode === 'short_base') return asBase();
  if (mode === 'short_full') return asFull();

  if (digits.length >= 2) {
    const base = digits.slice(0, -1);
    const check = digits.slice(-1);
    const expected = digitalRoot(base);
    if (expected !== null && String(expected) === check) {
      return { full_code: digits, base: String(Number(base)), checksum: expected };
    }
  }
  return asBase();
}

function parseUssdEntry(entry, prefix, mode){
  const trimmed = String(entry || '').trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/\s+/g, '');
  const hasSymbols = cleaned.includes('*') || cleaned.includes('#');
  const inputMode = mode || 'legacy';

  if (inputMode !== 'legacy') {
    if (hasSymbols) return { error: `legacy format not allowed: ${trimmed}` };
    return parseShortUssdEntry(cleaned, inputMode);
  }

  if (hasSymbols) {
    const full = cleaned.endsWith('#') ? cleaned : `${cleaned}#`;
    const lastStar = full.lastIndexOf('*');
    if (lastStar === -1) return { error: `invalid ussd code: ${trimmed}` };
    const body = full.slice(lastStar + 1).replace(/#$/, '');
    if (body.length < 2) return { error: `invalid ussd code: ${trimmed}` };
    const base = body.slice(0, -1);
    const checksum = Number(body.slice(-1));
    if (!/^\d+$/.test(base) || Number.isNaN(checksum)) {
      return { error: `invalid ussd code: ${trimmed}` };
    }
    return { full_code: full, base, checksum };
  }

  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return { error: `invalid base: ${trimmed}` };
  const checksum = Number(digits) % 9;
  return {
    full_code: `${prefix}${digits}${checksum}#`,
    base: digits,
    checksum,
  };
}

router.get('/ussd/pool/available', async (_req,res)=>{
  const { data, error } = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE').order('base');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.get('/ussd/pool/allocated', async (_req,res)=>{
  const { data, error } = await supabaseAdmin.from('ussd_pool').select('*').neq('status','AVAILABLE').order('allocated_at',{ascending:false});
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/ussd/pool/assign-next', async (req,res)=>{
  const prefix = req.body?.prefix || '';
  const tierRange = resolveUssdTierRange(req.body?.tier);
  let row = null;

  if (tierRange) {
    const { data, error } = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE');
    if (error) return res.status(500).json({ error: error.message });
    let rows = data || [];
    rows = rows.filter((item) => {
      const baseNum = Number(item.base);
      if (!Number.isFinite(baseNum)) return false;
      return baseNum >= tierRange.min && baseNum <= tierRange.max;
    });
    if (prefix) {
      const norm = String(prefix).toLowerCase();
      rows = rows.filter((item) => String(item.full_code || '').toLowerCase().startsWith(norm));
    }
    if (!rows.length) return res.json({ success:false, error:'no available codes in tier' });
    rows.sort((a, b) => Number(a.base) - Number(b.base));
    row = rows[0];
  } else {
    let query = supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE');
    if (prefix) {
      query = query.ilike('full_code', `${prefix}%`);
    }
    let result = await query.order('base', {ascending:true}).limit(1).maybeSingle();
    row = result.data;
    if (result.error) return res.status(500).json({ error: result.error.message });
    if (!row) {
      const alt = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE').order('base', {ascending:true}).limit(1).maybeSingle();
      row = alt.data;
      if (alt.error) return res.status(500).json({ error: alt.error.message });
      if (!row) return res.json({ success:false, error:'no available codes' });
    }
  }
  const upd = { status:'ALLOCATED', allocated_at: new Date().toISOString(), allocated_to_type: req.body?.level||'MATATU', allocated_to_id: req.body?.matatu_id || req.body?.sacco_id || null };
  const { error: ue } = await supabaseAdmin.from('ussd_pool').update(upd).eq('id', row.id);
  if (ue) return res.status(500).json({ error: ue.message });
  res.json({ success:true, ussd_code: row.full_code });
});
router.post('/ussd/bind-from-pool', async (req,res)=>{
  const code = req.body?.ussd_code;
  if (!code) return res.status(400).json({ success:false, error:'ussd_code required' });
  const { data: row, error } = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE').eq('full_code', code).single();
  if (error) return res.status(404).json({ success:false, error:'code not in pool' });
  const upd = { status:'ALLOCATED', allocated_at: new Date().toISOString(), allocated_to_type: req.body?.level||'MATATU', allocated_to_id: req.body?.matatu_id || req.body?.sacco_id || null };
  const { error: ue } = await supabaseAdmin.from('ussd_pool').update(upd).eq('id', row.id);
  if (ue) return res.status(500).json({ success:false, error: ue.message });
  res.json({ success:true, ussd_code: code });
});

router.post('/ussd/pool/release', async (req,res)=>{
  const id = req.body?.id || null;
  const code = req.body?.ussd_code || null;
  if (!id && !code) return res.status(400).json({ success:false, error:'id or ussd_code required' });
  let q = supabaseAdmin.from('ussd_pool')
    .update({ status:'AVAILABLE', allocated_at: null, allocated_to_type: null, allocated_to_id: null })
    .eq('status','ALLOCATED');
  if (id) q = q.eq('id', id);
  if (code) q = q.eq('full_code', code);
  const { data, error } = await q.select().maybeSingle();
  if (error) return res.status(500).json({ success:false, error: error.message });
  if (!data) return res.status(404).json({ success:false, error:'code not found' });
  res.json({ success:true, ussd_code: data.full_code });
});

router.post('/ussd/pool/import', async (req,res)=>{
  const inputModeRaw = String(req.body?.input_mode || 'legacy').trim().toLowerCase();
  const inputMode = ['short_base', 'short_full', 'short_auto', 'legacy'].includes(inputModeRaw)
    ? inputModeRaw
    : 'legacy';
  const prefix = inputMode === 'legacy' ? normalizeUssdPrefix(req.body?.prefix || '*001*') : '';
  const raw = req.body?.raw || '';
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : null;
  const lines = codes && codes.length ? codes : String(raw).split(/\r?\n/);
  const errors = [];
  const parsed = [];

  for (const line of lines) {
    const result = parseUssdEntry(line, prefix, inputMode);
    if (!result) continue;
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    parsed.push(result);
  }

  const deduped = new Map();
  parsed.forEach((row) => {
    if (row.full_code) deduped.set(row.full_code, row);
  });

  const rows = Array.from(deduped.values()).map((row) => ({
    base: row.base,
    checksum: row.checksum,
    full_code: row.full_code,
    status: 'AVAILABLE',
  }));

  if (!rows.length) {
    return res.status(400).json({ ok:false, error:'no valid codes found', errors });
  }

  const fullCodes = rows.map((row) => row.full_code);
  let existing = [];
  if (fullCodes.length) {
    const existingRes = await supabaseAdmin.from('ussd_pool').select('full_code').in('full_code', fullCodes);
    if (existingRes.error) return res.status(500).json({ ok:false, error: existingRes.error.message, errors });
    existing = existingRes.data || [];
  }
  const existingSet = new Set(existing.map((row) => row.full_code));
  const toInsert = rows.filter((row) => !existingSet.has(row.full_code));

  if (toInsert.length) {
    const { error } = await supabaseAdmin.from('ussd_pool').insert(toInsert);
    if (error) return res.status(500).json({ ok:false, error: error.message, errors });
  }

  res.json({
    ok: true,
    inserted: toInsert.length,
    skipped: rows.length - toInsert.length,
    errors,
  });
});

// Transactions for dashboard tables
router.get('/transactions/fees', async (_req,res)=>{
  const { data, error } = await supabaseAdmin.rpc('fees_today');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data||[] });
});
router.get('/transactions/loans', async (_req,res)=>{
  const { data, error } = await supabaseAdmin.rpc('loans_today');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data||[] });
});

// Staff, Loans (CRUD used by sacco dashboard)
router.get('/staff', async (req,res)=>{
  let q = supabaseAdmin.from('staff_profiles').select('*').order('created_at',{ascending:false});
  if (req.query.sacco_id) q = q.eq('sacco_id', req.query.sacco_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/staff', async (req,res)=>{
  const row = { sacco_id: req.body?.sacco_id, name: req.body?.name, phone: req.body?.phone, email: req.body?.email, role: req.body?.role||'SACCO_STAFF', user_id: req.body?.user_id||null };
  if(!row.sacco_id || !row.name) return res.status(400).json({error:'sacco_id and name are required'});
  const { data, error } = await supabaseAdmin.from('staff_profiles').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/loans', async (req,res)=>{
  let q = supabaseAdmin.from('loans').select('*').order('created_at',{ascending:false});
  if (req.query.sacco_id) q = q.eq('sacco_id', req.query.sacco_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data||[] });
});
router.post('/loans', async (req,res)=>{
  const row = { sacco_id: req.body?.sacco_id, matatu_id: req.body?.matatu_id||null, borrower_name: req.body?.borrower_name, principal_kes: req.body?.principal_kes||0, interest_rate_pct: req.body?.interest_rate_pct||0, term_months: req.body?.term_months||0, status: req.body?.status||'ACTIVE' };
  if(!row.sacco_id || !row.borrower_name) return res.status(400).json({error:'sacco_id and borrower_name are required'});
  const { data, error } = await supabaseAdmin.from('loans').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Routes and usage (system admin overview)
router.get('/routes', async (req,res)=>{
  try{
    let q = supabaseAdmin.from('routes').select('*').order('created_at',{ascending:false});
    if (req.query.sacco_id) q = q.eq('sacco_id', req.query.sacco_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data||[] });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load routes' });
  }
});

router.get('/routes/usage-summary', async (_req,res)=>{
  try{
    // basic usage: per sacco, count routes and recent trip_positions (last 7 days)
    const since = new Date(Date.now() - 7*24*3600*1000).toISOString();
    const [routesRes, posRes] = await Promise.all([
      supabaseAdmin.from('routes').select('id,sacco_id').order('sacco_id',{ascending:true}),
      supabaseAdmin
        .from('trip_positions')
        .select('id,sacco_id,route_id')
        .gte('recorded_at', since)
    ]);
    if (routesRes.error) throw routesRes.error;
    if (posRes.error) throw posRes.error;

    const bySacco = new Map();
    (routesRes.data||[]).forEach(r=>{
      const sid = String(r.sacco_id||'');
      if (!sid) return;
      const row = bySacco.get(sid) || { sacco_id: sid, routes:0, active_routes:0, trips_7d:0 };
      row.routes += 1;
      bySacco.set(sid,row);
    });
    const seenRoute = new Set();
    (posRes.data||[]).forEach(p=>{
      const sid = String(p.sacco_id||'');
      if (!sid) return;
      const row = bySacco.get(sid) || { sacco_id: sid, routes:0, active_routes:0, trips_7d:0 };
      row.trips_7d += 1;
      if (p.route_id && !seenRoute.has(p.route_id)){
        seenRoute.add(p.route_id);
        row.active_routes += 1;
      }
      bySacco.set(sid,row);
    });
    res.json({ items: Array.from(bySacco.values()) });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load routes usage summary' });
  }
});

// Create a new route (system admin only)
router.post('/routes', async (req,res)=>{
  try{
    const sacco_id = req.body?.sacco_id || null;
    const name = (req.body?.name || '').toString().trim();
    const code = (req.body?.code || '').toString().trim() || null;
    const start_stop = (req.body?.start_stop || '').toString().trim() || null;
    const end_stop = (req.body?.end_stop || '').toString().trim() || null;
    if (!name) return res.status(400).json({ error: 'name required' });

    let path_points = null;
    if (Array.isArray(req.body?.path_points)) {
      path_points = req.body.path_points
        .map(p => {
          const lat = Number(p.lat);
          const lng = Number(p.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const point = { lat, lng };
          if (p.ts) {
            try {
              point.ts = new Date(p.ts).toISOString();
            } catch {
              point.ts = null;
            }
          }
          return point;
        })
        .filter(Boolean);
      if (!path_points.length) {
        path_points = null;
      }
    }

    const row = { sacco_id, name, code, start_stop, end_stop, active: true, path_points };
    const { data, error } = await supabaseAdmin
      .from('routes')
      .insert(row)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to create route' });
  }
});

// Update an existing route (system admin only)
router.patch('/routes/:routeId', async (req,res)=>{
  const routeId = req.params.routeId;
  if (!routeId) return res.status(400).json({ error: 'routeId required' });
  try{
    const updates = {};
    if ('name' in req.body) {
      const name = (req.body?.name || '').toString().trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      updates.name = name;
    }
    if ('code' in req.body) {
      const code = (req.body?.code || '').toString().trim();
      updates.code = code || null;
    }
    if ('start_stop' in req.body) {
      const start_stop = (req.body?.start_stop || '').toString().trim();
      updates.start_stop = start_stop || null;
    }
    if ('end_stop' in req.body) {
      const end_stop = (req.body?.end_stop || '').toString().trim();
      updates.end_stop = end_stop || null;
    }
    if ('sacco_id' in req.body) {
      const sacco_id = req.body?.sacco_id || null;
      updates.sacco_id = sacco_id;
    }
    if ('active' in req.body) {
      updates.active = !!req.body.active;
    }

    if ('path_points' in req.body) {
      let path_points = null;
      if (Array.isArray(req.body?.path_points)) {
        path_points = req.body.path_points
          .map(p => {
            const lat = Number(p.lat);
            const lng = Number(p.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const point = { lat, lng };
            if (p.ts) {
              try {
                point.ts = new Date(p.ts).toISOString();
              } catch {
                point.ts = null;
              }
            }
            return point;
          })
          .filter(Boolean);
        if (!path_points.length) {
          path_points = null;
        }
      }
      updates.path_points = path_points;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const { data, error } = await supabaseAdmin
      .from('routes')
      .update(updates)
      .eq('id', routeId)
      .select('*')
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Route not found' });

    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to update route' });
  }
});

// Delete a route (system admin only)
router.delete('/routes/:routeId', async (req,res)=>{
  const routeId = req.params.routeId;
  if (!routeId) return res.status(400).json({ error: 'routeId required' });
  try{
    const { error } = await supabaseAdmin
      .from('routes')
      .delete()
      .eq('id', routeId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok:true });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to delete route' });
  }
});

module.exports = router;


// Supabase health for admin routes
router.get('/health', async (_req, res) => {
  try{
    if (!supabaseAdmin) return res.status(500).json({ ok:false, error:'service_role_missing' });
    const { error } = await supabaseAdmin.from('saccos').select('id', { head:true, count:'exact' }).limit(1);
    if (error) return res.status(500).json({ ok:false, error: error.message });
    return res.json({ ok:true });
  }catch(e){
    return res.status(500).json({ ok:false, error: e.message || 'unknown' });
  }
});


