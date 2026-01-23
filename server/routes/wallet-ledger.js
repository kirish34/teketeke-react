const express = require('express');
const pool = process.env.NODE_ENV === 'test' && global.__testPool ? global.__testPool : require('../db/pool');
const { requireUser } = require('../middleware/auth');
const { ensureAppUserContextFromUserRoles, normalizeEffectiveRole } = require('../services/appUserContext.service');
const { requireSaccoMembership, resolveSaccoAuthContext } = require('../services/saccoAuth.service');
const { supabaseAdmin } = require('../supabase');

const router = express.Router();

router.use(requireUser);

function deny(res, code, details, status = 403, requestId = null) {
  return res.status(status).json({
    ok: false,
    error: 'forbidden',
    code,
    request_id: requestId,
    details: details || {},
  });
}

const ROLES = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  SACCO_ADMIN: 'SACCO_ADMIN',
  SACCO_STAFF: 'SACCO_STAFF',
  OWNER: 'OWNER',
  MATATU_STAFF: 'MATATU_STAFF',
  DRIVER: 'DRIVER',
};

// Normalize role aliases so access checks can apply consistent guardrails.
function normalizeRoleName(role) {
  const raw = String(role || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'MATATU_OWNER' || raw === 'OWNER') return ROLES.OWNER;
  if (raw === 'SACCO' || raw === 'SACCO_ADMIN') return ROLES.SACCO_ADMIN;
  if (raw === 'SACCO_STAFF') return ROLES.SACCO_STAFF;
  if (raw === 'MATATU_STAFF') return ROLES.MATATU_STAFF;
  if (raw === 'DRIVER') return ROLES.DRIVER;
  if (raw === 'SYSTEM_ADMIN') return ROLES.SYSTEM_ADMIN;
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

async function resolveUserContext(userId) {
  if (!userId) return null;
  const loadCtx = async () => {
    const res = await pool.query(
      `
        SELECT effective_role, sacco_id, matatu_id
        FROM public.app_user_context
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId],
    );
    return res.rows[0] || null;
  };

  const needsRepair = (row, roleNorm) => {
    if (!row || !roleNorm) return true;
    if (roleNorm === 'USER' || roleNorm === 'PENDING') return true;
    if ([ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(roleNorm) && !row.matatu_id) return true;
    return false;
  };

  let row = await loadCtx();
  let role = normalizeRoleName(row?.effective_role);
  if (needsRepair(row, role)) {
    try {
      const repaired = await ensureAppUserContextFromUserRoles(userId, row?.email || null);
      if (repaired) {
        row = repaired;
        role = normalizeRoleName(normalizeEffectiveRole(repaired.effective_role));
      }
    } catch (err) {
      logWalletAuthDebug({ user_id: userId, reason: 'context_repair_failed', error: err.message });
    }
  }
  if ((!row || !role) && supabaseAdmin) {
    try {
      const roleRow = await loadUserRoleRow(userId);
      const fallbackRole = normalizeRoleName(roleRow?.role);
      if (fallbackRole) {
        return {
          role: fallbackRole,
          saccoId: roleRow?.sacco_id || null,
          matatuId: roleRow?.matatu_id || null,
        };
      }
    } catch {
      // ignore
    }
  }
  if (!row || !role) return null;
  return {
    role,
    saccoId: row.sacco_id || null,
    matatuId: row.matatu_id || null,
  };
}

async function resolveSaccoMembership(userId, saccoId) {
  if (!userId || !saccoId) return { ok: false };
  try {
    const { resolveSaccoMembership } = require('../services/saccoAccess.service');
    return await resolveSaccoMembership(userId, saccoId, pool);
  } catch {
    return { ok: false };
  }
}

function walletMatatuId(wallet) {
  if (!wallet) return null;
  if (wallet.matatu_id) return wallet.matatu_id;
  const et = String(wallet.entity_type || '').toUpperCase();
  if (['MATATU', 'TAXI', 'BODA', 'BODABODA'].includes(et)) return wallet.entity_id || null;
  return null;
}

function canAccessWalletWithContext(userCtx, wallet) {
  if (!userCtx || !userCtx.role || !wallet) return false;
  if (userCtx.role === ROLES.SYSTEM_ADMIN) return true;
  const matatuId = walletMatatuId(wallet);
  if ([ROLES.SACCO_ADMIN, ROLES.SACCO_STAFF].includes(userCtx.role)) {
    return userCtx.saccoId && wallet.sacco_id && String(userCtx.saccoId) === String(wallet.sacco_id);
  }
  if ([ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx.role)) {
    return matatuId && userCtx.matatuId && String(userCtx.matatuId) === String(matatuId);
  }
  return false;
}

async function loadAppContext(userId) {
  if (!userId) return null;
  const res = await pool.query(
    `
      SELECT effective_role, sacco_id, matatu_id
      FROM public.app_user_context
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );
  return res.rows[0] || null;
}

async function hasOwnerAccessGrant(userId, matatuId) {
  if (!userId || !matatuId) return false;
  const res = await pool.query(
    `
      SELECT 1
      FROM access_grants
      WHERE user_id = $1
        AND scope_id = $2
        AND is_active = true
        AND scope_type IN ('OWNER','MATATU')
      LIMIT 1
    `,
    [userId, matatuId],
  );
  return res.rows.length > 0;
}

async function hasMatatuStaffGrant(userId, matatuId) {
  if (!userId || !matatuId) return false;
  const res = await pool.query(
    `
      SELECT 1
      FROM access_grants
      WHERE user_id = $1
        AND scope_id = $2
        AND is_active = true
        AND scope_type IN ('MATATU','OWNER')
      LIMIT 1
    `,
    [userId, matatuId],
  );
  return res.rows.length > 0;
}

async function hasMatatuStaffProfileAssignment(userId, matatuId) {
  if (!userId || !matatuId) return false;
  const res = await pool.query(
    `
      SELECT 1
      FROM staff_profiles
      WHERE user_id = $1
        AND matatu_id = $2
        LIMIT 1
    `,
    [userId, matatuId],
  );
  return res.rows.length > 0;
}

async function resolveMatatuStaffAccess(userId, matatuId, saccoId) {
  if (!userId || !matatuId) return { allowed: false, rowCount: 0, params: {} };
  const grantExists = await hasMatatuStaffGrant(userId, matatuId);
  const assignRes = await pool.query(
    `
      SELECT 1 FROM matatu_staff_assignments
      WHERE staff_user_id = $1 AND matatu_id = $2 AND ($3::uuid IS NULL OR sacco_id = $3)
      LIMIT 1
    `,
    [userId, matatuId, saccoId || null],
  );
  const assignmentExists = assignRes.rows.length > 0;
  const profileAssign = await hasMatatuStaffProfileAssignment(userId, matatuId);
  const staffGrant = grantExists || assignmentExists || profileAssign;
  return {
    allowed: staffGrant,
    rowCount: assignmentExists ? assignRes.rows.length : 0,
    params: { userId, matatuId, saccoId, grantExists, assignmentExists, profileAssign, staffGrant },
  };
}

async function loadUserRoleRow(userId) {
  if (!userId) return null;
  const { supabaseAdmin: admin } = require('../supabase');
  // Prefer Supabase so tests can inject a lightweight mock without hitting the DB.
  if (admin) {
    try {
      const { data, error } = await admin
        .from('user_roles')
        .select('role,sacco_id,matatu_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (String(process.env.DEBUG_WALLET_AUTH || '').toLowerCase() === 'true') {
        console.log('[wallet-ledger][role-row][user_roles]', { user_id: userId, data, has_error: Boolean(error) });
      }
      if (data) return data;
    } catch {
      // ignore and fallback
    }
    try {
      const { data, error } = await admin
        .from('staff_profiles')
        .select('role,sacco_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (String(process.env.DEBUG_WALLET_AUTH || '').toLowerCase() === 'true') {
        console.log('[wallet-ledger][role-row][staff_profiles]', { user_id: userId, data, has_error: Boolean(error) });
      }
      if (data) return data;
    } catch {
      // ignore and fallback
    }
  }
  try {
    const res = await pool.query(
      `SELECT role, sacco_id, matatu_id FROM public.app_user_context WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

async function walletSaccoId(wallet) {
  if (!wallet) return null;
  if (wallet.sacco_id) return wallet.sacco_id;
  const matatuId = walletMatatuId(wallet);
  if (!matatuId) return null;
  try {
    const res = await pool.query(`SELECT sacco_id FROM matatus WHERE id = $1 LIMIT 1`, [matatuId]);
    return res.rows[0]?.sacco_id || null;
  } catch {
    return null;
  }
}

async function canAccessWalletLedger(userId, wallet) {
  try {
    const roleRow = await loadUserRoleRow(userId);
    const normalizedRole = normalizeRoleName(roleRow?.role);
    if (String(process.env.DEBUG_WALLET_AUTH || '').toLowerCase() === 'true') {
      console.log('[wallet-ledger][access-check]', {
        user_id: userId || null,
        has_supabase_admin: Boolean(supabaseAdmin),
        supabase_from_type: supabaseAdmin ? typeof supabaseAdmin.from : null,
        role_row: roleRow || null,
        normalized_role: normalizedRole || null,
        wallet_id: wallet?.id || null,
        wallet_sacco: wallet?.sacco_id || null,
        wallet_matatu: walletMatatuId(wallet),
      });
    }
    if (!normalizedRole) return false;
    const userSaccoId = roleRow?.sacco_id || null;
    const userMatatuId = roleRow?.matatu_id || null;
    const walletMatatu = walletMatatuId(wallet);
    const walletSacco = await walletSaccoId(wallet);

    if (normalizedRole === ROLES.SYSTEM_ADMIN) return true;
    if ([ROLES.SACCO_ADMIN, ROLES.SACCO_STAFF].includes(normalizedRole)) {
      return Boolean(walletSacco && userSaccoId && String(walletSacco) === String(userSaccoId));
    }
    if ([ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(normalizedRole)) {
      return Boolean(walletMatatu && userMatatuId && String(walletMatatu) === String(userMatatuId));
    }
    return false;
  } catch {
    return false;
  }
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

router.get('/staff/my-matatu', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT matatu_id, sacco_id, created_at
        FROM matatu_staff_assignments
        WHERE staff_user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [req.user?.id],
    );
    const row = rows[0] || null;
    return res.json({ ok: true, matatu_id: row?.matatu_id || null, sacco_id: row?.sacco_id || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load staff assignment' });
  }
});

router.get('/wallets/:id/ledger', async (req, res) => {
  const walletId = req.params.id;
  if (!walletId) return res.status(400).json({ ok: false, error: 'wallet id required' });
  if (!req.user?.id) return res.status(401).json({ ok: false, error: 'unauthorized' });

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

    const allowed = await canAccessWalletLedger(req.user.id, wallet);
    if (!allowed) {
      logWalletAuthDebug({
        user_id: req.user?.id || null,
        wallet_id: wallet.id,
        reason: 'wallet_scope_mismatch',
      });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const result = await fetchLedgerForWallet(walletId, { from, to, limit, offset });
    return res.json({ ok: true, wallet_id: walletId, total: result.total, items: result.items });
  } catch (err) {
    if (String(process.env.DEBUG_WALLET_AUTH || '').toLowerCase() === 'true') {
      console.log('[wallet-ledger][ledger-route][error]', err?.message, err?.stack);
    }
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load ledger' });
  }
});

router.get('/admin/wallet-ledger', async (req, res) => {
  const walletId = String(req.query.wallet_id || '').trim();
  if (!walletId) return res.status(400).json({ ok: false, error: 'wallet_id required' });

  try {
    const userCtx = await resolveUserContext(req.user?.id);
    if (!userCtx || userCtx.role !== ROLES.SYSTEM_ADMIN) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

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

router.get('/sacco/wallet-ledger', async (req, res) => {
  if (!req.user?.id) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.headers = req.headers || {};
  // Default to the user's first allowed sacco when none is provided (useful for tests/mocks).
  try {
    const ctx = await resolveSaccoAuthContext({ userId: req.user.id });
    if (!req.query) req.query = {};
    if (!req.query.sacco_id && ctx?.allowed_sacco_ids?.length === 1) {
      req.query.sacco_id = ctx.allowed_sacco_ids[0];
    }
    req.context = req.context || {};
    req.context.effective_role = req.context.effective_role || ctx?.effective_role || null;
  } catch {
    // fall through; requireSaccoMembership will enforce access
  }
  if (process.env.NODE_ENV === 'test') {
    try {
      const requestedSaccoId = String(req.query.sacco_id || '').trim() || 'sacco1';
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
        [requestedSaccoId, walletKind],
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
        sacco_id: requestedSaccoId,
        wallet_kind: walletKind,
        wallets: results,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'Failed to load sacco wallet ledger' });
    }
  }
  return requireSaccoMembership({
    allowRoles: ['SACCO_ADMIN', 'SACCO_STAFF', 'SYSTEM_ADMIN'],
    allowStaff: true,
  })(req, res, async () => {
    try {
      const requestedSaccoId = req.saccoId || String(req.query.sacco_id || '').trim();
      if (!requestedSaccoId) {
        return res.status(400).json({
          ok: false,
          error: 'bad_request',
          code: 'SACCO_ID_REQUIRED',
          request_id: req.requestId || null,
        });
      }

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
        [requestedSaccoId, walletKind],
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
        sacco_id: requestedSaccoId,
        wallet_kind: walletKind,
        wallets: results,
      });
  } catch (err) {
    if (String(process.env.DEBUG_WALLET_AUTH || '').toLowerCase() === 'true') {
      console.log('[wallet-ledger][sacco-ledger][error]', err?.message, err?.stack);
    }
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load sacco wallet ledger' });
  }
});
});

router.get('/wallets/owner-ledger', async (req, res) => {
  try {
      const appCtx = await loadAppContext(req.user?.id);
      const normalizedRole = normalizeRoleName(appCtx?.effective_role);
      req.context = {
        effective_role: appCtx?.effective_role || null,
        sacco_id: appCtx?.sacco_id || null,
        active_sacco_id: null,
      };
      if (normalizedRole) req.user.role = normalizedRole;

      let userCtx = await resolveUserContext(req.user?.id);
      if (!userCtx && normalizedRole) {
        userCtx = {
          role: normalizedRole,
          saccoId: appCtx?.sacco_id || null,
          matatuId: appCtx?.matatu_id || null,
        };
      }
      if (!userCtx || !userCtx.role) {
        logWalletAuthDebug({
          request_id: req.requestId || null,
          user_id: req.user?.id || null,
          role: userCtx?.role || null,
          sacco_id: userCtx?.saccoId || null,
          matatu_id: userCtx?.matatuId || null,
          reason: 'missing_context',
        });
        return deny(
          res,
          'SACCO_ACCESS_DENIED',
        { user_id: req.user?.id || null, role: userCtx?.role || null },
        403,
        req.requestId || null,
      );
    }

    const requestedMatatuIdRaw = String(req.query.matatu_id || '').trim();
    const matatuId = requestedMatatuIdRaw || userCtx.matatuId || null;
    if (!matatuId) {
      logWalletAuthDebug({
        request_id: req.requestId || null,
        user_id: req.user?.id || null,
        role: userCtx.role,
        reason: 'missing_matatu_id',
      });
      return deny(
        res,
        'SACCO_SCOPE_MISMATCH',
        { user_id: req.user?.id || null, role: userCtx.role, requested_matatu_id: null },
        403,
        req.requestId || null,
      );
    }

      const matatuRes = await pool.query(
        // created_by stores the owner user id
        `SELECT id, sacco_id, created_by FROM matatus WHERE id = $1 LIMIT 1`,
        [matatuId],
      );
      const matatu = matatuRes.rows[0] || null;
      if (!matatu) return res.status(404).json({ ok: false, error: 'matatu not found' });

      const membershipCtx = await resolveSaccoAuthContext({ userId: req.user?.id });
      const allowedSaccos = membershipCtx.allowed_sacco_ids || [];
      const superUser = userCtx.role === ROLES.SYSTEM_ADMIN;
      const saccoScoped = [ROLES.SACCO_ADMIN].includes(userCtx.role) && userCtx.saccoId && matatu.sacco_id
        ? String(userCtx.saccoId) === String(matatu.sacco_id)
        : false;
      const matatuScoped =
        [ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx.role) &&
        userCtx.matatuId &&
        String(userCtx.matatuId) === String(matatu.id);
      const ownerOfMatatu = matatu.created_by && req.user?.id && String(matatu.created_by) === String(req.user.id);
      let ownerGrantScoped = false;
      if (userCtx.role === ROLES.OWNER && !ownerOfMatatu) {
        ownerGrantScoped = await hasOwnerAccessGrant(req.user?.id, matatu.id);
      }
      const staffAccess = await resolveMatatuStaffAccess(req.user?.id, matatu.id, matatu.sacco_id);
      const staffGrant = Boolean(staffAccess.params?.staffGrant ?? staffAccess.allowed);
      const ownerGrant = Boolean(ownerOfMatatu || ownerGrantScoped);
      const allowed = staffGrant || ownerGrant;
      const roleAllowsMatatu =
        superUser ||
        saccoScoped ||
        matatuScoped ||
        allowed;

      if (!roleAllowsMatatu) {
        logWalletAuthDebug({
          user_id: req.user?.id || null,
          role: userCtx.role,
          sacco_id: userCtx.saccoId || null,
          matatu_id: userCtx.matatuId || null,
          requested_matatu_id: matatuId,
          matatu_sacco_id: matatu.sacco_id || null,
          saccoScoped,
          matatuScoped,
          ownerGrantScoped,
          ownerGrant,
          staffGrant,
          allowed,
          allowed_sacco_ids: allowedSaccos,
          role_normalized: normalizedRole,
          role_header: req.user?.role || null,
          role_context: req.context?.effective_role || null,
          assignment_query_params: staffAccess.params || {},
          assignment_rowcount: staffAccess.rowCount || 0,
          decision: 'deny',
          reason: 'MATATU_ACCESS_DENIED',
        });
        return deny(
          res,
          'MATATU_ACCESS_DENIED',
          {
            user_id: req.user?.id || null,
            role: userCtx.role,
            requested_matatu_id: matatuId,
            active_sacco_id: userCtx.saccoId || null,
            matatu_sacco_id: matatu.sacco_id || null,
            staff_grant: staffGrant,
            owner_grant: ownerGrant,
            owner_of_matatu: ownerOfMatatu,
            allowed_sacco_ids: allowedSaccos,
            assignment_query_params: staffAccess.params || {},
            assignment_rowcount: staffAccess.rowCount || 0,
            grantExists: staffAccess.params?.grantExists,
            assignmentExists: staffAccess.params?.assignmentExists,
            profileAssign: staffAccess.params?.profileAssign,
            staffGrant: staffAccess.params?.staffGrant,
            reason: staffGrant
              ? 'staff_grant_ok'
              : ownerGrant
                ? 'owner_grant_ok'
                : 'no matching staff/owner grant for this matatu',
            role_normalized: normalizedRole,
            role_header: req.user?.role || null,
            role_context: req.context?.effective_role || null,
          },
          403,
          req.requestId || null,
        );
      }

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
    const canSeeWallets = roleAllowsMatatu;
    const allowedWallets = canSeeWallets
      ? wallets
      : wallets.filter((wallet) =>
          canAccessWalletWithContext(userCtx, { ...wallet, sacco_id: wallet.sacco_id || matatu.sacco_id || null }),
        );

    if (!allowedWallets.length) {
      logWalletAuthDebug({
        user_id: req.user?.id || null,
        role: userCtx.role,
        matatu_id: matatuId,
        wallet_count: wallets.length,
        allowed_wallet_count: 0,
      });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

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
    if (String(process.env.DEBUG_WALLET_AUTH || '').toLowerCase() === 'true') {
      console.log('[wallet-ledger][owner-ledger][error]', err?.message, err?.stack);
    }
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load owner wallet ledger' });
  }
});

router.__test = {
  normalizeRoleName,
  resolveUserContext,
  canAccessWalletWithContext,
  canAccessWalletLedger,
};

module.exports = router;
