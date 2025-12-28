const express = require('express');
const { requireUser } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase');

if (!supabaseAdmin) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to serve mobile endpoints');
}

const router = express.Router();

router.use(requireUser);

const PG_ROW_NOT_FOUND = 'PGRST116';

function startOfDayISO(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfDayISO(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

async function getRoleRow(userId) {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && error.code !== PG_ROW_NOT_FOUND) {
    throw error;
  }
  return data || null;
}

async function getMatatu(rowMatatuId) {
  if (!rowMatatuId) return null;
  const { data, error } = await supabaseAdmin
    .from('matatus')
    .select('id,sacco_id,number_plate,owner_name,owner_phone,vehicle_type')
    .eq('id', rowMatatuId)
    .maybeSingle();
  if (error && error.code !== PG_ROW_NOT_FOUND) throw error;
  return data || null;
}

async function getSaccoDetails(saccoId) {
  if (!saccoId) return null;
  const { data, error } = await supabaseAdmin
    .from('saccos')
    .select('id,name,contact_name,contact_phone,contact_email,default_till')
    .eq('id', saccoId)
    .maybeSingle();
  if (error && error.code !== PG_ROW_NOT_FOUND) throw error;
  return data || null;
}

async function getSaccoContext(userId) {
  const role = await getRoleRow(userId);
  if (!role) return { role: null, saccoId: null, matatu: null };
  if (role.sacco_id) {
    return { role, saccoId: role.sacco_id, matatu: null };
  }
  if (role.matatu_id) {
    const matatu = await getMatatu(role.matatu_id);
    return { role, saccoId: matatu?.sacco_id || null, matatu };
  }
  return { role, saccoId: null, matatu: null };
}

async function ensureSaccoAccess(userId, requestedId) {
  const ctx = await getSaccoContext(userId);
  if (!ctx.saccoId) return { allowed: false, ctx };
  const match = String(ctx.saccoId) === String(requestedId);
  return { allowed: match, ctx };
}

async function ensureMatatuAccess(userId, requestedId) {
  const ctx = await getSaccoContext(userId);
  if (!requestedId) return { allowed: false, ctx, matatu: null };
  const matatu = await getMatatu(requestedId);
  if (!matatu) return { allowed: false, ctx, matatu: null };

  // Direct matatu roles must match the exact vehicle
  if (ctx.matatu) {
    // Owners may manage multiple matatus that share the same owner phone/name
    if (ctx.role?.role === 'OWNER') {
      const basePhone = ctx.matatu.owner_phone || null;
      const baseName = (ctx.matatu.owner_name || '').toString().trim().toLowerCase();
      const phoneMatch = basePhone && matatu.owner_phone && String(matatu.owner_phone) === String(basePhone);
      const nameMatch = baseName && (matatu.owner_name || '').toString().trim().toLowerCase() === baseName;
      if (phoneMatch || nameMatch) {
        // ensure saccoId reflects the requested matatu's SACCO
        const nextCtx = { ...ctx, saccoId: ctx.saccoId || matatu.sacco_id };
        return { allowed: true, ctx: nextCtx, matatu };
      }
    }

    const match = String(ctx.matatu.id) === String(requestedId);
    return { allowed: match, ctx, matatu };
  }

  // Otherwise fall back to sacco-scoped access
  if (ctx.saccoId && String(matatu.sacco_id) === String(ctx.saccoId)) {
    return { allowed: true, ctx, matatu };
  }
  return { allowed: false, ctx, matatu };
}

// Current user profile summary for front-end role guards
router.get('/me', async (req, res) => {
  try {
    const ctx = await getSaccoContext(req.user.id);
    const roleRow = await getRoleRow(req.user.id);

    let effectiveRole = roleRow?.role || null;
    let saccoId = ctx.saccoId || roleRow?.sacco_id || null;

    // Allow System Admins (from staff_profiles) to be recognised by role-guard
    if (!effectiveRole) {
      try {
        const { data: staff, error: staffErr } = await supabaseAdmin
          .from('staff_profiles')
          .select('role,sacco_id')
          .eq('user_id', req.user.id)
          .maybeSingle();
        if (!staffErr && staff?.role === 'SYSTEM_ADMIN') {
          effectiveRole = 'SYSTEM_ADMIN';
          if (!saccoId && staff.sacco_id) {
            saccoId = staff.sacco_id;
          }
        }
      } catch (_) {
        // If staff lookup fails we still return the basic profile
      }
    }

    res.json({
      role: effectiveRole,
      sacco_id: saccoId,
      matatu_id: ctx.matatu?.id || roleRow?.matatu_id || null,
      matatu_plate: ctx.matatu?.number_plate || null,
      email: req.user?.email || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load profile' });
  }
});

router.get('/my-saccos', async (req, res) => {
  try {
    const ctx = await getSaccoContext(req.user.id);
    if (!ctx.saccoId) return res.json({ items: [] });
    const sacco = await getSaccoDetails(ctx.saccoId);
    if (!sacco) return res.json({ items: [] });
    res.json({
      items: [
        {
          sacco_id: sacco.id,
          name: sacco.name,
          contact_name: sacco.contact_name,
          contact_phone: sacco.contact_phone,
          contact_email: sacco.contact_email,
          default_till: sacco.default_till,
          role: ctx.role?.role || null,
          via: ctx.matatu ? 'matatu' : 'direct',
          matatu_id: ctx.matatu?.id || null,
          matatu_plate: ctx.matatu?.number_plate || null,
        },
      ],
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load saccos' });
  }
});

// Return vehicles that the signed-in user can manage.
router.get('/vehicles', async (req, res) => {
  try {
    const ctx = await getSaccoContext(req.user.id);
    const roleRow = ctx.role || null;
    const roleName = roleRow?.role || null;

    // Matatu owners: allow multiple vehicles for the same owner (phone/name)
    if (roleName === 'OWNER' && roleRow?.matatu_id) {
      const primary = await getMatatu(roleRow.matatu_id);
      let items = [];
      if (!primary) {
        const { data, error } = await supabaseAdmin
          .from('matatus')
          .select('*')
          .eq('id', roleRow.matatu_id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        items = data || [];
      } else {
        let query = supabaseAdmin.from('matatus').select('*').order('created_at', { ascending: false });
        if (primary.owner_phone) {
          query = query.eq('owner_phone', primary.owner_phone);
        } else if (primary.owner_name) {
          query = query.eq('owner_name', primary.owner_name);
        } else {
          query = query.eq('id', primary.id);
        }
        const { data, error } = await query;
        if (error) throw error;
        items = data || [];
      }
      return res.json({ items });
    }

    // Default behaviour: sacco-scoped or single-matatu roles
    let query = supabaseAdmin.from('matatus').select('*').order('created_at', { ascending: false });
    if (ctx.saccoId) query = query.eq('sacco_id', ctx.saccoId);
    if (ctx.matatu?.id) query = query.eq('id', ctx.matatu.id);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load vehicles' });
  }
});

router.get('/sacco/:id/matatus', async (req, res) => {
  const saccoId = req.params.id;
  try {
    const { allowed, ctx } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    let query = supabaseAdmin
      .from('matatus')
      .select('*')
      .eq('sacco_id', saccoId)
      .order('number_plate', { ascending: true });
    if (ctx.role?.matatu_id && ctx.matatu?.id) {
      query = query.eq('id', ctx.matatu.id);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load matatus' });
  }
});

// SACCO routes (for matatu staff / owner UIs + sacco dashboard)
router.get('/sacco/:id/routes', async (req, res) => {
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error: 'sacco_id required' });
  try {
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const includeInactive = String(req.query.include_inactive || req.query.all || '')
      .toLowerCase() === 'true';

    let query = supabaseAdmin
      .from('routes')
      .select('*')
      .eq('sacco_id', saccoId);
    if (!includeInactive) {
      query = query.eq('active', true);
    }
    const { data, error } = await query.order('name', { ascending: true });
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load routes' });
  }
});

// Latest live positions for matatus in a SACCO (for map view)
router.get('/sacco/:id/live-positions', async (req, res) => {
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error: 'sacco_id required' });
  const routeFilter = (req.query.route_id || '').toString().trim() || null;
  const minutes = Math.max(1, Math.min(240, parseInt(req.query.window_min, 10) || 30));
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  try {
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    let query = supabaseAdmin
      .from('trip_positions')
      .select('matatu_id,route_id,lat,lng,recorded_at')
      .eq('sacco_id', saccoId)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: false })
      .limit(1000);
    if (routeFilter) {
      query = query.eq('route_id', routeFilter);
    }
    const { data, error } = await query;
    if (error) throw error;

    const latestByMatatu = new Map();
    (data || []).forEach(row => {
      const key = String(row.matatu_id || '');
      if (!key) return;
      if (!latestByMatatu.has(key)) {
        latestByMatatu.set(key, row);
      }
    });

    const items = Array.from(latestByMatatu.values());
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load live positions' });
  }
});

// Create a new SACCO route
router.post('/sacco/:id/routes', async (req, res) => {
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error: 'sacco_id required' });
  try {
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

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

    const row = { sacco_id: saccoId, name, code, start_stop, end_stop, active: true, path_points };
    const { data, error } = await supabaseAdmin
      .from('routes')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to create route' });
  }
});

// Update / toggle a SACCO route
router.patch('/sacco/:id/routes/:routeId', async (req, res) => {
  const saccoId = req.params.id;
  const routeId = req.params.routeId;
  if (!saccoId || !routeId) return res.status(400).json({ error: 'sacco_id and routeId required' });
  try {
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

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
      .eq('sacco_id', saccoId)
      .select('*')
      .maybeSingle();

    if (error) {
      if (error.code === PG_ROW_NOT_FOUND) return res.status(404).json({ error: 'Route not found' });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Route not found' });

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to update route' });
  }
});

// Delete a SACCO route
router.delete('/sacco/:id/routes/:routeId', async (req, res) => {
  const saccoId = req.params.id;
  const routeId = req.params.routeId;
  if (!saccoId || !routeId) return res.status(400).json({ error: 'sacco_id and routeId required' });
  try {
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await supabaseAdmin
      .from('routes')
      .delete()
      .eq('id', routeId)
      .eq('sacco_id', saccoId)
      .select('*')
      .maybeSingle();

    if (error) {
      if (error.code === PG_ROW_NOT_FOUND) return res.status(404).json({ error: 'Route not found' });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Route not found' });

    res.json({ deleted: 1, route: data });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to delete route' });
  }
});

router.get('/sacco/:id/transactions', async (req, res) => {
  const saccoId = req.params.id;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 2000);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * limit;
  try {
    const { allowed, ctx } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    let query = supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('sacco_id', saccoId)
      .order('created_at', { ascending: false });
    if (ctx.role?.matatu_id && ctx.matatu?.id) {
      // Matatu-scoped roles only see their vehicle's records
      query = query.eq('matatu_id', ctx.matatu.id);
    }

    const fromParam = req.query.from ? new Date(String(req.query.from)) : null;
    const toParam = req.query.to ? new Date(String(req.query.to)) : null;
    if (fromParam && !Number.isNaN(fromParam.getTime())) {
      query = query.gte('created_at', startOfDayISO(fromParam));
    }
    if (toParam && !Number.isNaN(toParam.getTime())) {
      query = query.lte('created_at', endOfDayISO(toParam));
    }

    const status = (req.query.status || '').toString().trim().toUpperCase();
    if (status) query = query.eq('status', status);

    const kind = (req.query.kind || '').toString().trim().toUpperCase();
    if (kind) query = query.eq('kind', kind);

    const search = (req.query.search || '').toString().trim();
    if (search) {
      const like = `%${search}%`;
      const orFilters = [
        `created_by_name.ilike.${like}`,
        `created_by_email.ilike.${like}`,
        `passenger_msisdn.ilike.${like}`,
        `notes.ilike.${like}`,
        `status.ilike.${like}`,
        `kind.ilike.${like}`,
      ];

      try {
        const { data: mats, error: mErr } = await supabaseAdmin
          .from('matatus')
          .select('id')
          .eq('sacco_id', saccoId)
          .ilike('number_plate', like);
        if (!mErr && mats && mats.length) {
          const ids = mats.map((m) => m.id).filter(Boolean);
          if (ids.length) {
            const quoted = ids.map((id) => `"${id}"`).join(',');
            orFilters.push(`matatu_id.in.(${quoted})`);
          }
        }
      } catch (_) {
        // ignore plate lookup failures
      }

      if (orFilters.length) {
        query = query.or(orFilters.join(','));
      }
    }

    query = query.range(offset, offset + limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ items: data || [], total: count || 0, page, limit });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load transactions' });
  }
});

router.get('/matatu/:id/transactions', async (req, res) => {
  const matatuId = req.params.id;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 2000);
  try {
    const { allowed, matatu } = await ensureMatatuAccess(req.user.id, matatuId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('matatu_id', matatu.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load transactions' });
  }
});

router.get('/matatu/by-plate', async (req,res)=>{
  const plate = (req.query.plate || '').trim().toUpperCase();
  if (!plate) return res.status(400).json({ error:'plate required' });
  try{
    const { data: matatu, error } = await supabaseAdmin
      .from('matatus')
      .select('*')
      .eq('number_plate', plate)
      .maybeSingle();
    if (error && error.code !== PG_ROW_NOT_FOUND) throw error;
    if (!matatu) return res.status(404).json({ error:'Matatu not found' });
    const { allowed } = await ensureMatatuAccess(req.user.id, matatu.id);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    res.json(matatu);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to lookup matatu' });
  }
});

router.patch('/matatu/:id', async (req,res)=>{
  const matatuId = req.params.id;
  if (!matatuId) return res.status(400).json({ error:'matatu_id required' });
  try{
    const { allowed, ctx, matatu } = await ensureMatatuAccess(req.user.id, matatuId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    if (!matatu) return res.status(404).json({ error:'Matatu not found' });

    const roleName = (ctx?.role?.role || '').toString().toUpperCase();
    if (!['SACCO','SACCO_ADMIN'].includes(roleName)) {
      return res.status(403).json({ error:'Forbidden' });
    }

    const updates = {};
    if ('number_plate' in req.body){
      const plate = (req.body?.number_plate || '').toString().trim().toUpperCase();
      if (!plate) return res.status(400).json({ error:'number_plate required' });
      updates.number_plate = plate;
    }
    if ('owner_name' in req.body){
      const owner = (req.body?.owner_name || '').toString().trim();
      updates.owner_name = owner || null;
    }
    if ('owner_phone' in req.body){
      const phone = (req.body?.owner_phone || '').toString().trim();
      updates.owner_phone = phone || null;
    }
    if ('tlb_number' in req.body){
      const tlb = (req.body?.tlb_number || '').toString().trim();
      updates.tlb_number = tlb || null;
    }
    if ('till_number' in req.body){
      const till = (req.body?.till_number || '').toString().trim();
      updates.till_number = till || null;
    }

    if (!Object.keys(updates).length){
      return res.status(400).json({ error:'No updates provided' });
    }

    const { data, error } = await supabaseAdmin
      .from('matatus')
      .update(updates)
      .eq('id', matatuId)
      .select('*')
      .maybeSingle();
    if (error){
      if (error.code === PG_ROW_NOT_FOUND) return res.status(404).json({ error:'Matatu not found' });
      throw error;
    }
    if (!data) return res.status(404).json({ error:'Matatu not found' });
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to update matatu' });
  }
});

router.get('/sacco/overview', async (req, res) => {
  try {
    const role = await getRoleRow(req.user.id);
    if (!role?.sacco_id) return res.status(403).json({ error: 'No SACCO assignment' });
    const saccoId = role.sacco_id;

    const [matatusRes, feesRes, loansRes] = await Promise.all([
      supabaseAdmin.from('matatus').select('id').eq('sacco_id', saccoId),
      supabaseAdmin
        .from('fees_payments')
        .select('amount')
        .eq('sacco_id', saccoId)
        .gte('created_at', startOfDayISO())
        .lte('created_at', endOfDayISO()),
      supabaseAdmin
        .from('loan_payments')
        .select('amount')
        .eq('sacco_id', saccoId)
        .gte('created_at', startOfDayISO())
        .lte('created_at', endOfDayISO()),
    ]);

    if (matatusRes.error) throw matatusRes.error;
    if (feesRes.error) throw feesRes.error;
    if (loansRes.error) throw loansRes.error;

    const activeMatatus = (matatusRes.data || []).length;
    const feesTotal = (feesRes.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const loansTotal = (loansRes.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);

    res.json({
      sacco_id: saccoId,
      active_matatus: activeMatatus,
      fees_today: feesTotal,
      loans_today: loansTotal,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load overview' });
  }
});

router.get('/ussd', async (req, res) => {
  try {
    const matatuId = req.query.matatu_id;
    if (!matatuId) return res.status(400).json({ error: 'matatu_id required' });
    const { data, error } = await supabaseAdmin
      .from('ussd_allocations')
      .select('full_code')
      .eq('matatu_id', matatuId)
      .order('allocated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const code = data && data.length ? data[0].full_code : null;
    res.json({ matatu_id: matatuId, ussd_code: code });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load USSD code' });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const role = await getRoleRow(req.user.id);
    const kind = String(req.query.kind || 'fees').toLowerCase();
    const table = kind === 'loans' ? 'loan_payments' : 'fees_payments';

    let query = supabaseAdmin.from(table).select('*').order('created_at', { ascending: false }).limit(200);
    if (role?.sacco_id) query = query.eq('sacco_id', role.sacco_id);
    if (role?.matatu_id) query = query.eq('matatu_id', role.matatu_id);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load transactions' });
  }
});

router.get('/sacco/:id/staff', async (req,res)=>{
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error:'sacco_id required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const { data, error } = await supabaseAdmin
      .from('staff_profiles')
      .select('*')
      .eq('sacco_id', saccoId)
      .order('created_at', { ascending:false });
    if (error) throw error;
    res.json({ items: data || [] });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load staff' });
  }
});

router.post('/sacco/:id/staff', async (req,res)=>{
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error:'sacco_id required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error:'name required' });

    const email = (req.body?.email || '').trim() || null;
    const phone = (req.body?.phone || '').trim() || null;
    const roleReq = (req.body?.role || 'SACCO_STAFF').toString().toUpperCase();
    const password = (req.body?.password || '').toString().trim();

    let userId = req.body?.user_id || null;

    // If email provided but no user_id, create or resolve Supabase Auth user using service role
    if (!userId && email) {
      try {
        const created = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          password: password || (Math.random().toString(36).slice(2) + 'X1!')
        });
        if (created.error) {
          // If user exists, try to fetch by listing
          let page = 1, found = null;
          while (page <= 25) {
            const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
            if (error) break;
            found = (data?.users||[]).find(u => (u.email||'').toLowerCase() === email.toLowerCase());
            if (found) break;
            page += 1;
          }
          if (found) userId = found.id; else throw created.error;
        } else {
          userId = created.data?.user?.id || null;
        }
      } catch (e) {
        return res.status(500).json({ error: e.message || 'Failed to create auth user' });
      }
    }

    // Map role values into canonical values used in user_roles
    const normalizedRole = (roleReq === 'DRIVER' || roleReq === 'MATATU_STAFF') ? 'STAFF' : roleReq;

    // If we have a user, upsert user_roles so they gain access to this SACCO
    if (userId) {
      const { error: urErr } = await supabaseAdmin
        .from('user_roles')
        .upsert({ user_id: userId, role: normalizedRole, sacco_id: saccoId, matatu_id: null }, { onConflict: 'user_id' });
      if (urErr) return res.status(500).json({ error: urErr.message || 'Failed to upsert user role' });
    }

    const { data, error } = await supabaseAdmin
      .from('staff_profiles')
      .insert({ sacco_id: saccoId, name, phone, email, role: roleReq, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to create staff' });
  }
});

router.patch('/sacco/:id/staff/:staffId', async (req,res)=>{
  const saccoId = req.params.id; const staffId = req.params.staffId;
  if (!saccoId || !staffId) return res.status(400).json({ error:'sacco_id and staffId required' });
  try{
    const { allowed, ctx } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const roleName = (ctx?.role?.role || '').toString().toUpperCase();
    if (!['SACCO','SACCO_ADMIN'].includes(roleName)) {
      return res.status(403).json({ error:'Forbidden' });
    }

    const updates = {};
    if ('name' in req.body){
      const name = (req.body?.name || '').toString().trim();
      if (!name) return res.status(400).json({ error:'name required' });
      updates.name = name;
    }
    if ('phone' in req.body){
      const phone = (req.body?.phone || '').toString().trim();
      updates.phone = phone || null;
    }
    if ('email' in req.body){
      const email = (req.body?.email || '').toString().trim();
      updates.email = email || null;
    }
    let roleReq = null;
    if ('role' in req.body){
      roleReq = (req.body?.role || '').toString().toUpperCase().trim();
      if (!roleReq) return res.status(400).json({ error:'role required' });
      if (!['SACCO_STAFF','SACCO_ADMIN','SACCO'].includes(roleReq)) {
        return res.status(400).json({ error:'Invalid role' });
      }
      updates.role = roleReq;
    }

    if (!Object.keys(updates).length){
      return res.status(400).json({ error:'No updates provided' });
    }

    const { data, error } = await supabaseAdmin
      .from('staff_profiles')
      .update(updates)
      .eq('id', staffId)
      .eq('sacco_id', saccoId)
      .select('*')
      .maybeSingle();
    if (error) {
      if (error.code === PG_ROW_NOT_FOUND) return res.status(404).json({ error:'Staff not found' });
      throw error;
    }
    if (!data) return res.status(404).json({ error:'Staff not found' });

    if (roleReq && data.user_id){
      const normalizedRole = (roleReq === 'DRIVER' || roleReq === 'MATATU_STAFF') ? 'STAFF' : roleReq;
      const { error: urErr } = await supabaseAdmin
        .from('user_roles')
        .upsert(
          { user_id: data.user_id, role: normalizedRole, sacco_id: saccoId, matatu_id: null },
          { onConflict: 'user_id' }
        );
      if (urErr) throw urErr;
    }

    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to update staff' });
  }
});

// Delete staff and revoke SACCO role access
router.delete('/sacco/:id/staff/:staffId', async (req,res)=>{
  const saccoId = req.params.id; const staffId = req.params.staffId;
  if (!saccoId || !staffId) return res.status(400).json({ error:'sacco_id and staffId required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const { data: staff, error: sErr } = await supabaseAdmin
      .from('staff_profiles').select('id,user_id,role').eq('id', staffId).eq('sacco_id', saccoId).maybeSingle();
    if (sErr) throw sErr;
    if (!staff) return res.status(404).json({ error:'Staff not found' });
    const { error: delErr } = await supabaseAdmin.from('staff_profiles').delete().eq('id', staffId).eq('sacco_id', saccoId);
    if (delErr) throw delErr;
    if (staff.user_id){
      await supabaseAdmin.from('user_roles').delete()
        .eq('user_id', staff.user_id)
        .eq('sacco_id', saccoId)
        .in('role', ['SACCO_STAFF','SACCO_ADMIN']);
    }
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to delete staff' }); }
});

router.get('/sacco/:id/loans', async (req,res)=>{
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error:'sacco_id required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const { data, error } = await supabaseAdmin
      .from('loans')
      .select('*')
      .eq('sacco_id', saccoId)
      .order('created_at', { ascending:false });
    if (error) throw error;
    res.json({ items: data || [] });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load loans' });
  }
});

// Daily fee rates per SACCO (used by SACCO admin + staff UIs)
router.get('/sacco/:id/daily-fee-rates', async (req,res)=>{
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error:'sacco_id required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const { data, error } = await supabaseAdmin
      .from('daily_fee_rates')
      .select('*')
      .eq('sacco_id', saccoId)
      .order('vehicle_type', { ascending:true });
    if (error) throw error;
    res.json({ items: data || [] });
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to load daily fee rates' });
  }
});

router.post('/sacco/:id/daily-fee-rates', async (req,res)=>{
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error:'sacco_id required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const vehicle_type = (req.body?.vehicle_type || '').toString().trim();
    const amt = Number(req.body?.daily_fee_kes ?? req.body?.amount_kes ?? 0);
    if (!vehicle_type) return res.status(400).json({ error:'vehicle_type required' });
    if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error:'daily_fee_kes must be a non-negative number' });
    const row = { sacco_id: saccoId, vehicle_type, daily_fee_kes: amt };
    const { data, error } = await supabaseAdmin
      .from('daily_fee_rates')
      .upsert(row, { onConflict: 'sacco_id,vehicle_type' })
      .select('*')
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to upsert daily fee rate' });
  }
});

// Loan requests
router.get('/sacco/:id/loan-requests', async (req,res)=>{
  const saccoId = req.params.id;
  const statusRaw = (req.query.status || '').toString().toUpperCase();
  const statuses = statusRaw
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean);
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    let query = supabaseAdmin
      .from('loan_requests')
      .select('*')
      .eq('sacco_id', saccoId)
      .order('created_at', { ascending:false });
    if (statuses.length === 1) query = query.eq('status', statuses[0]);
    if (statuses.length > 1) query = query.in('status', statuses);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ items: data || [] });
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to load loan requests' }); }
});

// Create a loan request (matatu-scoped)
router.post('/matatu/:id/loan-requests', async (req,res)=>{
  const matatuId = req.params.id;
  try{
    const { allowed, matatu } = await ensureMatatuAccess(req.user.id, matatuId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    if (!matatu) return res.status(404).json({ error:'Matatu not found' });
    if (!matatu.sacco_id) return res.status(400).json({ error:'This matatu is not linked to any SACCO. Please contact your SACCO to attach the vehicle before requesting a loan.' });
    const amount = Number(req.body?.amount_kes || 0);
    const model = (req.body?.model || 'MONTHLY').toString().toUpperCase();
    const term = Math.max(1, Math.min(6, Number(req.body?.term_months || 1)));
    const note = (req.body?.note || '').toString();

    const payoutRaw = (req.body?.payout_method || '').toString().toUpperCase();
    const allowedPayout = ['CASH','M_PESA','ACCOUNT'];
    const payout_method = allowedPayout.includes(payoutRaw) ? payoutRaw : null;
    const payout_phone_raw = (req.body?.payout_phone || '').toString().trim();
    const payout_account_raw = (req.body?.payout_account || '').toString().trim();
    const payout_phone = payout_method === 'M_PESA' && payout_phone_raw ? payout_phone_raw : null;
    const payout_account = payout_method === 'ACCOUNT' && payout_account_raw ? payout_account_raw : null;

    if (!amount) return res.status(400).json({ error:'amount_kes required' });
    if (!['DAILY','WEEKLY','MONTHLY'].includes(model)) return res.status(400).json({ error:'invalid model' });
    const row = {
      sacco_id: matatu.sacco_id,
      matatu_id: matatu.id,
      owner_name: matatu.owner_name || '',
      amount_kes: amount,
      model,
      term_months: term,
      note,
      payout_method,
      payout_phone,
      payout_account,
      status: 'PENDING'
    };
    const { data, error } = await supabaseAdmin.from('loan_requests').insert(row).select('*').single();
    if (error) throw error;
    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to create loan request' }); }
});

// Approve/Reject request; on approve create a loan
router.patch('/sacco/:id/loan-requests/:reqId', async (req,res)=>{
  const saccoId = req.params.id; const reqId = req.params.reqId;
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const action = (req.body?.action || '').toString().toUpperCase();
    const rejectionReason = (req.body?.rejection_reason ?? req.body?.reason ?? '').toString().trim();
    if (!['APPROVE','REJECT'].includes(action)) return res.status(400).json({ error:'action must be APPROVE or REJECT' });
    const { data: R, error: rErr } = await supabaseAdmin
      .from('loan_requests').select('*').eq('id', reqId).eq('sacco_id', saccoId).maybeSingle();
    if (rErr) throw rErr;
    if (!R) return res.status(404).json({ error:'Request not found' });

    let updates = {
      status: action==='APPROVE' ? 'APPROVED' : 'REJECTED',
      decided_at: new Date().toISOString(),
      rejection_reason: action === 'REJECT' && rejectionReason ? rejectionReason : null
    };
    let createdLoan = null;
    if (action === 'APPROVE'){
      const perMonth = (R.model==='DAILY'?10:(R.model==='WEEKLY'?20:30));
      const interest_rate_pct = perMonth * Math.max(1, Number(R.term_months||1));
      const row = {
        sacco_id: saccoId,
        matatu_id: R.matatu_id || null,
        borrower_name: R.owner_name || 'Owner',
        principal_kes: Number(R.amount_kes||0),
        interest_rate_pct,
        term_months: Number(R.term_months||1),
        status: 'ACTIVE',
        collection_model: R.model || 'MONTHLY',
        start_date: new Date().toISOString().slice(0,10)
      };
      const { data: L, error: lErr } = await supabaseAdmin.from('loans').insert(row).select('*').single();
      if (lErr) throw lErr;
      createdLoan = L;
      updates.loan_id = L.id;

      // Automatically mark disbursement using the requested payout preference
      const allowedMethods = ['CASH','M_PESA','ACCOUNT'];
      let disbMethod = (R.payout_method || 'CASH').toString().toUpperCase();
      if (!allowedMethods.includes(disbMethod)) disbMethod = 'CASH';
      const now = new Date().toISOString();
      updates.disbursed_at = now;
      updates.disbursed_by = req.user.id;
      updates.disbursed_method = disbMethod;
      updates.disbursed_reference = null;
      updates.payout_phone = disbMethod === 'M_PESA' ? (R.payout_phone || null) : (R.payout_phone || null);
      updates.payout_account = disbMethod === 'ACCOUNT' ? (R.payout_account || null) : (R.payout_account || null);
    }
    const { data: U, error: uErr } = await supabaseAdmin
      .from('loan_requests').update(updates).eq('id', reqId).eq('sacco_id', saccoId).select('*').maybeSingle();
    if (uErr) throw uErr;
    res.json({ request: U, loan: createdLoan });
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to process loan request' }); }
});

// Mark an approved loan request as disbursed (cash / M-PESA / account transfer)
router.post('/sacco/:id/loan-requests/:reqId/disburse', async (req,res)=>{
  const saccoId = req.params.id; const reqId = req.params.reqId;
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const { data: R, error: rErr } = await supabaseAdmin
      .from('loan_requests').select('*').eq('id', reqId).eq('sacco_id', saccoId).maybeSingle();
    if (rErr) throw rErr;
    if (!R) return res.status(404).json({ error:'Request not found' });
    if (String(R.status||'').toUpperCase() !== 'APPROVED'){
      return res.status(400).json({ error:'Only approved requests can be disbursed' });
    }
    if (R.disbursed_at){
      return res.status(400).json({ error:'Request already marked as disbursed' });
    }
    const allowedMethods = ['CASH','M_PESA','ACCOUNT'];
    const methodRaw = (req.body?.method || R.payout_method || 'CASH').toString().toUpperCase();
    if (!allowedMethods.includes(methodRaw)){
      return res.status(400).json({ error:'Invalid disbursement method' });
    }
    const phone = (req.body?.phone || R.payout_phone || '').toString().trim() || null;
    const account = (req.body?.account || R.payout_account || '').toString().trim() || null;
    const reference = (req.body?.reference || '').toString().trim() || null;

    const now = new Date().toISOString();
    const patch = {
      disbursed_at: now,
      disbursed_by: req.user.id,
      disbursed_method: methodRaw,
      disbursed_reference: reference || null,
      payout_phone: methodRaw === 'M_PESA' ? phone : R.payout_phone,
      payout_account: methodRaw === 'ACCOUNT' ? account : R.payout_account
    };

    const { data: U, error: uErr } = await supabaseAdmin
      .from('loan_requests')
      .update(patch)
      .eq('id', reqId)
      .eq('sacco_id', saccoId)
      .select('*')
      .maybeSingle();
    if (uErr) throw uErr;
    res.json(U || {});
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to mark disbursement' });
  }
});
// Loan payment history for a given loan (based on matatu_id and date window)
router.get('/sacco/:id/loans/:loanId/payments', async (req,res)=>{
  const saccoId = req.params.id; const loanId = req.params.loanId;
  if (!saccoId || !loanId) return res.status(400).json({ error:'sacco_id and loanId required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const { data: loan, error: lErr } = await supabaseAdmin
      .from('loans').select('*').eq('id', loanId).eq('sacco_id', saccoId).maybeSingle();
    if (lErr) throw lErr;
    if (!loan) return res.status(404).json({ error:'Loan not found' });
    if (!loan.matatu_id) return res.json({ items: [], total: Number(loan.principal_kes||0)*(1+Number(loan.interest_rate_pct||0)/100) });
    // Compute time window
    const start = loan.start_date ? new Date(loan.start_date) : new Date();
    const end = addMonths(new Date(start), Math.max(1, Number(loan.term_months||1)));
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('sacco_id', saccoId)
      .eq('matatu_id', loan.matatu_id)
      .eq('kind','LOAN_REPAY')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending:false });
    if (error) throw error;
    const total = Number(loan.principal_kes||0)*(1+Number(loan.interest_rate_pct||0)/100);
    res.json({ items: data||[], total });
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to load loan payments' }); }
});

// Update loan (status only for now)
router.patch('/sacco/:id/loans/:loanId', async (req,res)=>{
  const saccoId = req.params.id; const loanId = req.params.loanId;
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const status = (req.body?.status || '').toString().toUpperCase();
    if (!status) return res.status(400).json({ error:'status required' });
    const { data, error } = await supabaseAdmin
      .from('loans')
      .update({ status })
      .eq('id', loanId)
      .eq('sacco_id', saccoId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    res.json(data||{});
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to update loan' }); }
});

// Delete loan
router.delete('/sacco/:id/loans/:loanId', async (req,res)=>{
  const saccoId = req.params.id; const loanId = req.params.loanId;
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const { error } = await supabaseAdmin.from('loans').delete().eq('id', loanId).eq('sacco_id', saccoId);
    if (error) throw error;
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to delete loan' }); }
});

// --- Loan schedule helpers ---
function addMonths(d, m){ const x=new Date(d); x.setMonth(x.getMonth()+m); return x; }
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function nextWeekday(onOrAfter){ const d=new Date(onOrAfter); let w=d.getDay(); if (w===6) d.setDate(d.getDate()+2); else if (w===0) d.setDate(d.getDate()+1); return startOfDay(d); }
function computeNextDue(row, today=new Date()){
  const model = String(row.collection_model||'MONTHLY');
  const term = Number(row.term_months||1);
  const start = startOfDay(row.start_date ? new Date(row.start_date) : new Date());
  const end = addMonths(start, Math.max(1, term));
  const t0 = startOfDay(today);
  if (t0 > end) return null;
  if (model === 'DAILY'){
    const d = t0 < start ? start : t0; return nextWeekday(d);
  }
  if (model === 'WEEKLY'){
    const msWeek = 7*24*3600*1000; const base=start.getTime(); const now=t0.getTime();
    const k = Math.ceil((now - base) / msWeek); const next = new Date(base + Math.max(0,k)*msWeek); return startOfDay(next);
  }
  let months = (t0.getFullYear()-start.getFullYear())*12 + (t0.getMonth()-start.getMonth());
  if (t0.getDate() > start.getDate()) months += 1;
  const next = addMonths(start, Math.max(0, months)); return startOfDay(next);
}

// Loans due today/overdue (simple schedule-based)
router.get('/sacco/:id/loans/due-today', async (req,res)=>{
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error:'sacco_id required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const { data, error } = await supabaseAdmin
      .from('loans')
      .select('id,sacco_id,matatu_id,borrower_name,principal_kes,interest_rate_pct,term_months,collection_model,start_date,created_at')
      .eq('sacco_id', saccoId);
    if (error) throw error;
    const today = new Date(); const todayISO=today.toISOString().slice(0,10);
    const items = (data||[]).map(row=>{
      const nextDue = computeNextDue(row, today);
      let status = 'FUTURE';
      if (nextDue){ const dISO = nextDue.toISOString().slice(0,10); if (dISO === todayISO) status='TODAY'; else if (dISO < todayISO) status='OVERDUE'; }
      return { ...row, next_due_date: nextDue ? nextDue.toISOString().slice(0,10) : null, due_status: status };
    }).filter(r => r.due_status==='TODAY' || r.due_status==='OVERDUE');
    res.json({ items });
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to compute due loans' }); }
});

router.post('/sacco/:id/loans', async (req,res)=>{
  const saccoId = req.params.id;
  if (!saccoId) return res.status(400).json({ error:'sacco_id required' });
  try{
    const { allowed } = await ensureSaccoAccess(req.user.id, saccoId);
    if (!allowed) return res.status(403).json({ error:'Forbidden' });
    const row = {
      sacco_id: saccoId,
      matatu_id: req.body?.matatu_id || null,
      borrower_name: (req.body?.borrower_name || '').trim(),
      principal_kes: Number(req.body?.principal_kes || 0),
      interest_rate_pct: Number(req.body?.interest_rate_pct || 0),
      term_months: Number(req.body?.term_months || 0),
      status: req.body?.status || 'ACTIVE'
    };
    if (!row.borrower_name) return res.status(400).json({ error:'borrower_name required' });
    const { data, error } = await supabaseAdmin
      .from('loans')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message || 'Failed to create loan' });
  }
});

// ---------- Matatu staff management (owner-scoped) ----------
async function ensureMatatuWithAccess(req, res){
  const matatuId = req.params.id;
  if (!matatuId) { res.status(400).json({ error:"matatu_id required" }); return null; }
  const { allowed, matatu } = await ensureMatatuAccess(req.user.id, matatuId);
  if (!allowed || !matatu) { res.status(403).json({ error:"Forbidden" }); return null; }
  return matatu;
}

router.get("/matatu/:id/staff", async (req,res)=>{
  try{
    const matatu = await ensureMatatuWithAccess(req,res); if(!matatu) return;
    const { data, error } = await supabaseAdmin
      .from("staff_profiles")
      .select("*")
      .eq("matatu_id", matatu.id)
      .order("created_at", { ascending:false });
    if (error) throw error;
    res.json({ items: data||[] });
  }catch(e){ res.status(500).json({ error: e.message || "Failed to load staff" }); }
});

router.post("/matatu/:id/staff", async (req,res)=>{
  try{
    const matatu = await ensureMatatuWithAccess(req,res); if(!matatu) return;
    const name  = (req.body?.name || "").trim();
    const phone = (req.body?.phone || "").trim() || null;
    const email = (req.body?.email || "").trim() || null;
    const role  = (req.body?.role || "STAFF").toString().toUpperCase();
    const password = (req.body?.password || "").toString().trim();
    if (!name) return res.status(400).json({ error:"name required" });

    let userId = req.body?.user_id || null;
    if (!userId && email){
      const created = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true, password: password || Math.random().toString(36).slice(2) + 'X1!' });
      if (created.error){
        let page=1, found=null;
        while(page<=25){
          const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
          if (error) break;
          found = (data?.users||[]).find(u => (u.email||"").toLowerCase() === email.toLowerCase());
          if (found) break; page++;
        }
        if (found) userId = found.id; else throw created.error;
      }else{
        userId = created.data?.user?.id || null;
      }
    }

    if (userId){
      const normalizedRole = (role === 'DRIVER' || role === 'MATATU_STAFF') ? 'STAFF' : role;
      const { error: urErr } = await supabaseAdmin
        .from('user_roles')
        .upsert({ user_id: userId, role: normalizedRole, sacco_id: matatu.sacco_id || null, matatu_id: matatu.id }, { onConflict: 'user_id' });
      if (urErr) throw urErr;
    }

    const { data, error } = await supabaseAdmin
      .from('staff_profiles')
      .insert({ sacco_id: matatu.sacco_id || null, matatu_id: matatu.id, name, phone, email, role: role || 'STAFF', user_id: userId })
      .select().single();
    if (error) throw error;
    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to add staff' }); }
});

router.patch('/matatu/:id/staff/:staff_id', async (req,res)=>{
  try{
    const matatu = await ensureMatatuWithAccess(req,res); if(!matatu) return;
    const staffId = req.params.staff_id;
    if (!staffId) return res.status(400).json({ error:'staff_id required' });
    const updates = {};

    if ('name' in req.body){
      const name = (req.body?.name || '').toString().trim();
      if (!name) return res.status(400).json({ error:'name required' });
      updates.name = name;
    }
    if ('phone' in req.body){
      const phone = (req.body?.phone || '').toString().trim();
      updates.phone = phone || null;
    }
    if ('email' in req.body){
      const email = (req.body?.email || '').toString().trim();
      updates.email = email || null;
    }

    let requestedRole = null;
    if ('role' in req.body){
      requestedRole = (req.body?.role || '').toString().toUpperCase().trim();
      if (!requestedRole) return res.status(400).json({ error:'role required' });
      updates.role = requestedRole;
    }

    if (!Object.keys(updates).length){
      return res.status(400).json({ error:'No updates provided' });
    }

    const { data, error } = await supabaseAdmin
      .from('staff_profiles')
      .update(updates)
      .eq('id', staffId)
      .eq('matatu_id', matatu.id)
      .select()
      .single();

    if (error){
      if (error.code === PG_ROW_NOT_FOUND) return res.status(404).json({ error:'Staff member not found' });
      throw error;
    }

    if (requestedRole && data?.user_id){
      const normalizedRole = (requestedRole === 'DRIVER' || requestedRole === 'MATATU_STAFF') ? 'STAFF' : requestedRole;
      const { error: urErr } = await supabaseAdmin
        .from('user_roles')
        .update({ role: normalizedRole })
        .eq('user_id', data.user_id)
        .eq('matatu_id', matatu.id);
      if (urErr) throw urErr;
    }

    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to update staff' }); }
});

router.delete('/matatu/:id/staff/:user_id', async (req,res)=>{
  try{
    const matatu = await ensureMatatuWithAccess(req,res); if(!matatu) return;
    const uid = req.params.user_id;
    if (!uid) return res.status(400).json({ error:'user_id required' });
    await supabaseAdmin.from('staff_profiles').delete().eq('matatu_id', matatu.id).eq('user_id', uid);
    await supabaseAdmin.from('user_roles').delete().eq('matatu_id', matatu.id).eq('user_id', uid);
    res.json({ deleted: 1 });
  }catch(e){ res.status(500).json({ error: e.message || 'Failed to remove staff' }); }
});
module.exports = router;
