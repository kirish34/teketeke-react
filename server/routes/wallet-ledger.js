const express = require('express');
const pool = require('../db/pool');
const { supabaseAdmin } = require('../supabase');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

if (!supabaseAdmin) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to serve wallet ledger endpoints');
}

router.use(requireUser);

// Normalize role aliases so access checks can apply consistent guardrails.
function normalizeRoleName(role, row = null) {
  const raw = String(role || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'MATATU_OWNER' || raw === 'OWNER') return 'OWNER';
  if (raw === 'SACCO' || raw === 'SACCO_ADMIN') return 'SACCO_ADMIN';
  if (raw === 'SACCO_STAFF') return 'SACCO_STAFF';
  if (raw === 'STAFF') return row?.sacco_id ? 'SACCO_STAFF' : 'STAFF';
  if (raw === 'SYSTEM_ADMIN') return 'SYSTEM_ADMIN';
  if (raw === 'BODA' || raw === 'BODABODA') return 'BODA';
  if (raw === 'TAXI') return 'TAXI';
  return raw;
}

function logWalletAuthDebug(payload) {
  if (String(process.env.DEBUG_WALLET_AUTH || '').toLowerCase() !== 'true') return;
  try {
    console.log('[wallet-ledger][auth]', {
      ...payload,
    });
  } catch {
    // no-op on logging errors
  }
}

function normalizeDateBounds(fromRaw, toRaw) {
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const dateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (from && Number.isNaN(from.getTime())) return { from: null, to: null, error: 'Invalid from date' };
  if (to && Number.isNaN(to.getTime())) return { from: null, to: null, error: 'Invalid to date' };

  if (from && dateOnly(fromRaw)) from.setHours(0, 0, 0, 0);
  if (to && dateOnly(toRaw)) to.setHours(23, 59, 59, 999);

  return { from, to, error: null };
}

async function isSystemAdmin(userId) {
  if (!userId) return false;
  const { data, error } = await supabaseAdmin
    .from('staff_profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeRoleName(data?.role) === 'SYSTEM_ADMIN';
}

async function getUserRole(userId) {
  if (!userId) return null;
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('role,sacco_id,matatu_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getStaffRole(userId) {
  if (!userId) return null;
  const { data, error } = await supabaseAdmin
    .from('staff_profiles')
    .select('role,sacco_id,matatu_id,phone,name')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function resolveRoleRow(userId) {
  const userRole = await getUserRole(userId);
  if (userRole) return userRole;
  return getStaffRole(userId);
}

async function hasOwnerAccessGrant(userId, matatuId) {
  if (!userId || !matatuId) return false;
  const { data, error } = await supabaseAdmin
    .from('access_grants')
    .select('user_id')
    .eq('user_id', userId)
    .eq('scope_id', matatuId)
    .eq('is_active', true)
    .in('scope_type', ['OWNER', 'MATATU'])
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function matchesOwnerWallet({ role, wallet }) {
  if (!role?.matatu_id) return false;
  const walletMatatuId =
    wallet.matatu_id ||
    (['MATATU', 'TAXI', 'BODA', 'BODABODA'].includes(String(wallet.entity_type || '').toUpperCase())
      ? wallet.entity_id
      : null);
  if (!walletMatatuId) return false;

  const baseRes = await pool.query(
    `SELECT owner_name, owner_phone FROM matatus WHERE id = $1 LIMIT 1`,
    [role.matatu_id],
  );
  const targetRes = await pool.query(
    `SELECT owner_name, owner_phone FROM matatus WHERE id = $1 LIMIT 1`,
    [walletMatatuId],
  );
  const base = baseRes.rows[0];
  const target = targetRes.rows[0];
  if (!base || !target) return false;

  const basePhone = String(base.owner_phone || '').trim();
  const targetPhone = String(target.owner_phone || '').trim();
  if (basePhone && targetPhone && basePhone === targetPhone) return true;

  const baseName = String(base.owner_name || '').trim().toLowerCase();
  const targetName = String(target.owner_name || '').trim().toLowerCase();
  if (baseName && targetName && baseName === targetName) return true;

  return false;
}

async function loadMatatuBasic(matatuId) {
  if (!matatuId) return null;
  const res = await pool.query(
    `SELECT id, sacco_id, number_plate, owner_name, owner_phone FROM matatus WHERE id = $1 LIMIT 1`,
    [matatuId],
  );
  return res.rows[0] || null;
}

async function findMatatuByOwnerContact({ phone, name }) {
  const phoneValue = String(phone || '').trim();
  const nameValue = String(name || '').trim();
  if (!phoneValue && !nameValue) return null;
  // Match by owner phone/name to let owners with missing matatu_id recover context without broadening scope.
  const res = await pool.query(
    `
      SELECT id, sacco_id, number_plate, owner_name, owner_phone
      FROM matatus
      WHERE (($1::text IS NOT NULL AND owner_phone = $1)
        OR ($2::text IS NOT NULL AND LOWER(owner_name) = LOWER($2)))
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [phoneValue || null, nameValue || null],
  );
  return res.rows[0] || null;
}

async function canAccessWalletLedger(userId, wallet) {
  if (!userId || !wallet) return false;
  if (await isSystemAdmin(userId)) return true;

  const role = (await getUserRole(userId)) || (await getStaffRole(userId));
  if (!role) return false;

  const roleName = normalizeRoleName(role.role, role);
  const walletMatatuId =
    wallet.matatu_id ||
    (['MATATU', 'TAXI', 'BODA', 'BODABODA'].includes(String(wallet.entity_type || '').toUpperCase())
      ? wallet.entity_id
      : null);
  const saccoMatch =
    ['SACCO_ADMIN', 'SACCO_STAFF'].includes(roleName) &&
    role.sacco_id &&
    wallet.sacco_id &&
    String(role.sacco_id) === String(wallet.sacco_id);
  if (saccoMatch) {
    logWalletAuthDebug({
      user_id: userId,
      role: roleName,
      reason: 'sacco_match',
      wallet_id: wallet.id || null,
      sacco_id: wallet.sacco_id || null,
    });
    return true;
  }

  if (walletMatatuId && role.matatu_id && String(role.matatu_id) === String(walletMatatuId)) {
    logWalletAuthDebug({
      user_id: userId,
      role: roleName,
      reason: 'matatu_match',
      wallet_id: wallet.id || null,
      matatu_id: walletMatatuId,
    });
    return true;
  }

  if (roleName === 'OWNER') {
    const allowed = await matchesOwnerWallet({ role, wallet });
    logWalletAuthDebug({
      user_id: userId,
      role: roleName,
      reason: allowed ? 'owner_match' : 'owner_no_match',
      wallet_id: wallet.id || null,
      matatu_id: walletMatatuId || null,
    });
    return allowed;
  }

  return false;
}

async function fetchLedgerForWallet(walletId, { from = null, to = null, limit = 100, offset = 0 } = {}) {
  const params = [walletId];
  const where = ['wallet_id = $1'];
  if (from) {
    params.push(from.toISOString());
    where.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`created_at <= $${params.length}`);
  }
  const whereClause = `WHERE ${where.join(' AND ')}`;

  const countRes = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM wallet_ledger
      ${whereClause}
    `,
    params,
  );
  const total = countRes.rows[0]?.total || 0;

  params.push(limit);
  params.push(offset);
  const rowsRes = await pool.query(
    `
      SELECT *
      FROM wallet_ledger
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
    params,
  );

  return { total, items: rowsRes.rows || [] };
}

function normalizeLimitOffset(limitRaw, offsetRaw) {
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  return { limit, offset };
}

router.get('/wallets/:id/ledger', async (req, res) => {
  const walletId = req.params.id;
  if (!walletId) return res.status(400).json({ ok: false, error: 'wallet id required' });

  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const { limit, offset } = normalizeLimitOffset(limitRaw, offsetRaw);

  const { from, to, error } = normalizeDateBounds(req.query.from, req.query.to);
  if (error) return res.status(400).json({ ok: false, error });

  try {
    const walletRes = await pool.query(
      `
        SELECT id, sacco_id, matatu_id, entity_type, entity_id
        FROM wallets
        WHERE id = $1
        LIMIT 1
      `,
      [walletId],
    );
    if (!walletRes.rows.length) return res.status(404).json({ ok: false, error: 'wallet not found' });
    const wallet = walletRes.rows[0];

    const allowed = await canAccessWalletLedger(req.user?.id, wallet);
    if (!allowed) return res.status(403).json({ ok: false, error: 'forbidden' });

    const result = await fetchLedgerForWallet(walletId, { from, to, limit, offset });
    return res.json({ ok: true, wallet_id: walletId, total: result.total, items: result.items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load ledger' });
  }
});

router.get('/admin/wallet-ledger', async (req, res) => {
  const walletId = String(req.query.wallet_id || '').trim();
  if (!walletId) return res.status(400).json({ ok: false, error: 'wallet_id required' });

  try {
    const isAdmin = await isSystemAdmin(req.user?.id);
    if (!isAdmin) return res.status(403).json({ ok: false, error: 'forbidden' });

    const walletRes = await pool.query(
      `SELECT id, wallet_kind, sacco_id, virtual_account_code FROM wallets WHERE id = $1 LIMIT 1`,
      [walletId],
    );
    if (!walletRes.rows.length) return res.status(404).json({ ok: false, error: 'wallet not found' });

    const { from, to, error } = normalizeDateBounds(req.query.from, req.query.to);
    if (error) return res.status(400).json({ ok: false, error });

    const { limit, offset } = normalizeLimitOffset(Number(req.query.limit), Number(req.query.offset));
    const ledger = await fetchLedgerForWallet(walletId, { from, to, limit, offset });

    return res.json({
      ok: true,
      wallet: walletRes.rows[0],
      total: ledger.total,
      items: ledger.items,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load wallet ledger' });
  }
});

function isSaccoWalletKind(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ['SACCO_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS'].includes(normalized);
}

function isMatatuOwnerWalletKind(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ['MATATU_OWNER', 'MATATU_VEHICLE'].includes(normalized);
}

async function resolveSaccoIdForUser(userId) {
  const role = await getUserRole(userId);
  if (role?.sacco_id) return role.sacco_id;
  if (!userId) return null;
  const { data, error } = await supabaseAdmin
    .from('staff_profiles')
    .select('sacco_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.sacco_id || null;
}

router.get('/sacco/wallet-ledger', async (req, res) => {
  try {
    const saccoId = await resolveSaccoIdForUser(req.user?.id);
    if (!saccoId) return res.status(403).json({ ok: false, error: 'forbidden' });

    const kindRaw = String(req.query.wallet_kind || '').trim().toUpperCase();
    const walletKind = kindRaw && isSaccoWalletKind(kindRaw) ? kindRaw : null;
    const { from, to, error } = normalizeDateBounds(req.query.from, req.query.to);
    if (error) return res.status(400).json({ ok: false, error });
    const { limit, offset } = normalizeLimitOffset(Number(req.query.limit), Number(req.query.offset));

    const walletsRes = await pool.query(
      `
        SELECT id, wallet_kind, virtual_account_code, balance
        FROM wallets
        WHERE sacco_id = $1
          AND wallet_kind IN ('SACCO_FEE','SACCO_LOAN','SACCO_SAVINGS')
          AND ($2::text IS NULL OR wallet_kind = $2)
        ORDER BY wallet_kind
      `,
      [saccoId, walletKind],
    );
    const wallets = walletsRes.rows || [];
    const results = [];
    for (const wallet of wallets) {
      const ledger = await fetchLedgerForWallet(wallet.id, { from, to, limit, offset });
      results.push({
        wallet_id: wallet.id,
        wallet_kind: wallet.wallet_kind,
        virtual_account_code: wallet.virtual_account_code,
        balance: Number(wallet.balance || 0),
        total: ledger.total,
        items: ledger.items,
      });
    }

    return res.json({
      ok: true,
      sacco_id: saccoId,
      wallet_kind: walletKind,
      wallets: results,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load sacco wallet ledger' });
  }
});

router.get('/wallets/owner-ledger', async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = (await getUserRole(userId)) || null;
    const staffRole = (await getStaffRole(userId)) || null;
    const effectiveRole = userRole || staffRole;
    if (!effectiveRole) {
      logWalletAuthDebug({ user_id: userId || null, reason: 'missing_role' });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const roleName = normalizeRoleName(effectiveRole.role, effectiveRole);
    if (!roleName) {
      logWalletAuthDebug({ user_id: userId || null, reason: 'missing_role_normalized' });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const requestedMatatuIdRaw = String(req.query.matatu_id || '').trim();
    const roleMatatuId = effectiveRole?.matatu_id || null;
    let matatuId = requestedMatatuIdRaw || roleMatatuId || null;

    let baseMatatu = roleMatatuId ? await loadMatatuBasic(roleMatatuId) : null;

    if (!matatuId && roleName === 'OWNER' && (staffRole?.phone || staffRole?.name)) {
      const inferred = await findMatatuByOwnerContact({
        phone: staffRole?.phone,
        name: staffRole?.name,
      });
      if (inferred) {
        matatuId = String(inferred.id);
        baseMatatu = inferred;
      }
    }

    if (!matatuId) {
      logWalletAuthDebug({ user_id: userId || null, role: roleName, reason: 'missing_matatu_id' });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    // Resolve matatu's sacco_id to use for permission checks when wallets lack sacco_id
    const matatuRes = await pool.query(
      `SELECT id, sacco_id, owner_name, owner_phone FROM matatus WHERE id = $1 LIMIT 1`,
      [matatuId],
    );
    const matatu = matatuRes.rows[0] || null;
    if (!matatu) return res.status(404).json({ ok: false, error: 'matatu not found' });

    // Normalize/infer role context
    const saccoIdFromRole = effectiveRole?.sacco_id || null;
    let saccoId = saccoIdFromRole || null;
    if ((roleName === 'SACCO_STAFF' || roleName === 'SACCO_ADMIN') && !saccoId && matatu.sacco_id) {
      saccoId = matatu.sacco_id;
    }

    // Owners only gain scoped access when we can tie them to the vehicle via phone/name or explicit matatu_id.
    const ownerContactMatch =
      roleName === 'OWNER' &&
      !!baseMatatu &&
      ((baseMatatu.owner_phone &&
        matatu.owner_phone &&
        String(baseMatatu.owner_phone) === String(matatu.owner_phone)) ||
        (baseMatatu.owner_name &&
          matatu.owner_name &&
          String(baseMatatu.owner_name).trim().toLowerCase() ===
            String(matatu.owner_name).trim().toLowerCase()));

    const saccoScoped =
      !!saccoId &&
      !!matatu.sacco_id &&
      String(saccoId) === String(matatu.sacco_id) &&
      ['SACCO_STAFF', 'SACCO_ADMIN', 'SYSTEM_ADMIN'].includes(roleName);
    const superUser = roleName === 'SYSTEM_ADMIN';
    const ownerScoped =
      roleName === 'OWNER' &&
      (!!roleMatatuId ? String(roleMatatuId) === String(matatu.id) : ownerContactMatch);
    const hasGrant = await hasOwnerAccessGrant(userId, matatu.id);

    const kindRaw = String(req.query.wallet_kind || '').trim().toUpperCase();
    const walletKind = kindRaw && isMatatuOwnerWalletKind(kindRaw) ? kindRaw : null;
    const { from, to, error } = normalizeDateBounds(req.query.from, req.query.to);
    if (error) return res.status(400).json({ ok: false, error });
    const { limit, offset } = normalizeLimitOffset(Number(req.query.limit), Number(req.query.offset));

    const walletsRes = await pool.query(
      `
        SELECT id, wallet_kind, sacco_id, matatu_id, entity_type, entity_id, virtual_account_code, balance
        FROM wallets
        WHERE matatu_id = $1
          AND wallet_kind IN ('MATATU_OWNER','MATATU_VEHICLE')
          AND ($2::text IS NULL OR wallet_kind = $2)
        ORDER BY wallet_kind
      `,
      [matatuId, walletKind],
    );
    const wallets = walletsRes.rows || [];
    const allowedWallets = [];
    const debugCtx = {
      user_id: userId || null,
      role_row: effectiveRole,
      role: roleName || null,
      sacco_id: saccoId || null,
      matatu_id: matatuId,
      saccoScoped,
      ownerScoped,
      ownerContactMatch,
      hasGrant,
      wallet_count: wallets.length,
    };
    for (const wallet of wallets) {
      // If wallet lacks sacco_id, fall back to the matatu's sacco for permission checks
      const enrichedWallet = { ...wallet, sacco_id: wallet.sacco_id || matatu.sacco_id || null };
      const allowed =
        superUser ||
        saccoScoped ||
        ownerScoped ||
        hasGrant ||
        (await canAccessWalletLedger(userId, enrichedWallet));
      if (allowed) allowedWallets.push(wallet);
    }

    if (!allowedWallets.length) {
      logWalletAuthDebug({ ...debugCtx, allowed_wallet_count: 0 });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    logWalletAuthDebug({ ...debugCtx, allowed_wallet_count: allowedWallets.length });

    const results = [];
    for (const wallet of allowedWallets) {
      const ledger = await fetchLedgerForWallet(wallet.id, { from, to, limit, offset });
      results.push({
        wallet_id: wallet.id,
        wallet_kind: wallet.wallet_kind,
        virtual_account_code: wallet.virtual_account_code,
        balance: Number(wallet.balance || 0),
        total: ledger.total,
        items: ledger.items,
      });
    }

    return res.json({
      ok: true,
      wallets: results,
      matatu_id: matatuId,
      wallet_kind: walletKind,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load owner wallet ledger' });
  }
});

router.__test = {
  normalizeRoleName,
  canAccessWalletLedger,
  matchesOwnerWallet,
  resolveRoleRow,
};

module.exports = router;
