const express = require('express');
const pool = require('../db/pool');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

router.use(requireUser);

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
  const res = await pool.query(
    `
      SELECT effective_role, sacco_id, matatu_id
      FROM public.app_user_context
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const role = normalizeRoleName(row.effective_role);
  return {
    role,
    saccoId: row.sacco_id || null,
    matatuId: row.matatu_id || null,
  };
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
    const userCtx = await resolveUserContext(req.user?.id);
    if (!userCtx || !userCtx.role) {
      logWalletAuthDebug({ user_id: req.user?.id || null, reason: 'missing_context' });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

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

    const allowed = canAccessWalletWithContext(userCtx, wallet);
    if (!allowed) {
      logWalletAuthDebug({
        user_id: req.user?.id || null,
        role: userCtx.role,
        sacco_id: userCtx.saccoId || null,
        matatu_id: userCtx.matatuId || null,
        wallet_id: wallet.id,
        reason: 'wallet_scope_mismatch',
      });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

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
  try {
    const requestedSaccoId = String(req.query.sacco_id || '').trim();
    if (!requestedSaccoId) return res.status(400).json({ ok: false, error: 'sacco_id required' });

    const userCtx = await resolveUserContext(req.user?.id);
    if (!userCtx || !userCtx.role) return res.status(403).json({ ok: false, error: 'forbidden' });
    const saccoAllowed =
      userCtx.role === ROLES.SYSTEM_ADMIN ||
      ([ROLES.SACCO_ADMIN, ROLES.SACCO_STAFF].includes(userCtx.role) &&
        userCtx.saccoId &&
        String(userCtx.saccoId) === String(requestedSaccoId));
    if (!saccoAllowed) {
      logWalletAuthDebug({
        user_id: req.user?.id || null,
        role: userCtx.role,
        sacco_id: userCtx.saccoId || null,
        requested_sacco_id: requestedSaccoId,
        reason: 'sacco_scope_mismatch',
      });
      return res.status(403).json({ ok: false, error: 'forbidden' });
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
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load sacco wallet ledger' });
  }
});

router.get('/wallets/owner-ledger', async (req, res) => {
  try {
    const userCtx = await resolveUserContext(req.user?.id);
    if (!userCtx || !userCtx.role) {
      logWalletAuthDebug({ user_id: req.user?.id || null, reason: 'missing_context' });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const requestedMatatuIdRaw = String(req.query.matatu_id || '').trim();
    const matatuId = requestedMatatuIdRaw || userCtx.matatuId || null;
    if (!matatuId) {
      logWalletAuthDebug({ user_id: req.user?.id || null, role: userCtx.role, reason: 'missing_matatu_id' });
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const matatuRes = await pool.query(
      `SELECT id, sacco_id FROM matatus WHERE id = $1 LIMIT 1`,
      [matatuId],
    );
    const matatu = matatuRes.rows[0] || null;
    if (!matatu) return res.status(404).json({ ok: false, error: 'matatu not found' });

    const superUser = userCtx.role === ROLES.SYSTEM_ADMIN;
    const saccoScoped =
      [ROLES.SACCO_ADMIN, ROLES.SACCO_STAFF].includes(userCtx.role) &&
      userCtx.saccoId &&
      matatu.sacco_id &&
      String(userCtx.saccoId) === String(matatu.sacco_id);
    const matatuScoped =
      [ROLES.OWNER, ROLES.MATATU_STAFF, ROLES.DRIVER].includes(userCtx.role) &&
      userCtx.matatuId &&
      String(userCtx.matatuId) === String(matatu.id);
    let ownerGrantScoped = false;
    if (userCtx.role === ROLES.OWNER && !matatuScoped) {
      if (userCtx.saccoId && matatu.sacco_id && String(userCtx.saccoId) === String(matatu.sacco_id)) {
        ownerGrantScoped = true;
      } else {
        ownerGrantScoped = await hasOwnerAccessGrant(req.user?.id, matatu.id);
      }
    }
    const roleAllowsMatatu = superUser || saccoScoped || matatuScoped || ownerGrantScoped;

    if (!roleAllowsMatatu) {
      logWalletAuthDebug({
        user_id: req.user?.id || null,
        role: userCtx.role,
        sacco_id: userCtx.saccoId || null,
        matatu_id: userCtx.matatuId || null,
        requested_matatu_id: matatuId,
        saccoScoped,
        matatuScoped,
        ownerGrantScoped,
        reason: 'matatu_scope_mismatch',
      });
      return res.status(403).json({ ok: false, error: 'forbidden' });
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
    const allowedWallets = wallets.filter((wallet) =>
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
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load owner wallet ledger' });
  }
});

router.__test = {
  normalizeRoleName,
  resolveUserContext,
  canAccessWalletWithContext,
};

module.exports = router;
