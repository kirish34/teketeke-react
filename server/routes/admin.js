const express = require('express');
const { supabaseAdmin } = require('../supabase');
const pool = require('../db/pool');
const { registerWalletForEntity } = require('../wallet/wallet.service');
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
    const [{ count: saccos }, { count: matatus }, { count: staff }, { data: txTodayRows }] = await Promise.all([
      supabaseAdmin.from('saccos').select('*', { count:'exact', head:true }),
      supabaseAdmin.from('matatus').select('*', { count:'exact', head:true }),
      supabaseAdmin.from('staff_profiles').select('*', { count:'exact', head:true }),
      supabaseAdmin.rpc('count_tx_today')
    ]);
    const { data: poolAvail } = await supabaseAdmin.from('ussd_pool').select('id').eq('status','AVAILABLE');
    const { data: poolAll }   = await supabaseAdmin.from('ussd_pool').select('id', { count: 'exact' });
    res.json({ counts: { saccos: saccos||0, matatus: matatus||0, cashiers: staff||0, tx_today: (txTodayRows||0) }, ussd_pool: { available: (poolAvail||[]).length, total: (poolAll?.length||0) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
      const found = data.users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
      if (found) return found.id;
      page += 1;
    }
    throw new Error('Supabase user ' + email + ' exists but could not be retrieved');
  }
  const userId = createRes.data?.user?.id;
  if (!userId) throw new Error('Failed to resolve created user id');
  return userId;
}

async function upsertUserRole({ user_id, role, sacco_id = null, matatu_id = null }){
  const normalizeRole = (r)=> (r==='DRIVER'||r==='MATATU_STAFF') ? 'STAFF' : r;
  role = normalizeRole(role);
  const { error } = await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id, role, sacco_id, matatu_id }, { onConflict: 'user_id' });
  if (error) throw error;
}

router.post('/register-sacco', async (req,res)=>{
  const row = { name: req.body?.name, contact_name: req.body?.contact_name, contact_phone: req.body?.contact_phone, contact_email: req.body?.contact_email, default_till: req.body?.default_till };
  if(!row.name) return res.status(400).json({error:'name required'});
  const loginEmail = (req.body?.login_email || '').trim();
  const loginPassword = req.body?.login_password || '';
  if ((loginEmail && !loginPassword) || (!loginEmail && loginPassword)) {
    return res.status(400).json({ error:'Provide both login_email and login_password or neither' });
  }
  const { data, error } = await supabaseAdmin.from('saccos').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const result = { ...data };
  if (loginEmail && loginPassword){
    try{
      const userId = await ensureAuthUser(loginEmail, loginPassword);
      await upsertUserRole({ user_id: userId, role: 'SACCO', sacco_id: data.id });
      result.created_user = { email: loginEmail, role: 'SACCO' };
    }catch(e){
      result.login_error = e.message || 'Failed to create sacco login';
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
    const userId = await ensureAuthUser(email, password);
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

function parseUssdEntry(entry, prefix){
  const trimmed = String(entry || '').trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/\s+/g, '');
  const hasSymbols = cleaned.includes('*') || cleaned.includes('#');
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
  const prefix = req.body?.prefix || '*001*';
  let { data: row, error } = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE').ilike('full_code', `${prefix}%`).order('base', {ascending:true}).limit(1).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row) {
    const alt = await supabaseAdmin.from('ussd_pool').select('*').eq('status','AVAILABLE').order('base', {ascending:true}).limit(1).maybeSingle();
    row = alt.data; error = alt.error;
    if (error) return res.status(500).json({ error: error.message });
    if (!row) return res.json({ success:false, error:'no available codes' });
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
  const prefix = normalizeUssdPrefix(req.body?.prefix || '*001*');
  const raw = req.body?.raw || '';
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : null;
  const lines = codes && codes.length ? codes : String(raw).split(/\r?\n/);
  const errors = [];
  const parsed = [];

  for (const line of lines) {
    const result = parseUssdEntry(line, prefix);
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


