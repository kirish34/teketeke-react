const express = require('express');
const pool = require('../db/pool');
const { supabaseAdmin } = require('../supabase');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

if (!supabaseAdmin) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to serve wallet ledger endpoints');
}

router.use(requireUser);

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
  return String(data?.role || '').toUpperCase() === 'SYSTEM_ADMIN';
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

async function canAccessWalletLedger(userId, wallet) {
  if (!userId || !wallet) return false;
  if (await isSystemAdmin(userId)) return true;

  const role = await getUserRole(userId);
  if (!role) return false;

  const roleName = String(role.role || '').toUpperCase();
  if (role.sacco_id && wallet.sacco_id && String(role.sacco_id) === String(wallet.sacco_id)) {
    return true;
  }

  const walletMatatuId =
    wallet.matatu_id ||
    (['MATATU', 'TAXI', 'BODA', 'BODABODA'].includes(String(wallet.entity_type || '').toUpperCase())
      ? wallet.entity_id
      : null);
  if (walletMatatuId && role.matatu_id && String(role.matatu_id) === String(walletMatatuId)) {
    return true;
  }

  if (roleName === 'OWNER') {
    return matchesOwnerWallet({ role, wallet });
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
    const role = await getUserRole(req.user?.id);
    const matatuId = role?.matatu_id || null;
    if (!matatuId) return res.status(403).json({ ok: false, error: 'forbidden' });

    const kindRaw = String(req.query.wallet_kind || '').trim().toUpperCase();
    const walletKind = kindRaw && isMatatuOwnerWalletKind(kindRaw) ? kindRaw : null;
    const { from, to, error } = normalizeDateBounds(req.query.from, req.query.to);
    if (error) return res.status(400).json({ ok: false, error });
    const { limit, offset } = normalizeLimitOffset(Number(req.query.limit), Number(req.query.offset));

    const walletsRes = await pool.query(
      `
        SELECT id, wallet_kind, virtual_account_code, balance
        FROM wallets
        WHERE matatu_id = $1
          AND wallet_kind IN ('MATATU_OWNER','MATATU_VEHICLE')
          AND ($2::text IS NULL OR wallet_kind = $2)
        ORDER BY wallet_kind
      `,
      [matatuId, walletKind],
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
      wallets: results,
      matatu_id: matatuId,
      wallet_kind: walletKind,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load owner wallet ledger' });
  }
});

module.exports = router;
