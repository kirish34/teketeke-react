const pool = require('../db/pool');
const { registerWalletForEntity } = require('../wallet/wallet.service');

const PAYBILL_NUMBER =
  process.env.MPESA_C2B_SHORTCODE || process.env.DARAJA_SHORTCODE || process.env.PAYBILL_NUMBER || '4814003';

function normalizeEntityType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (t === 'TAXI' || t === 'BODA' || t === 'BODABODA') return t === 'BODABODA' ? 'BODA' : t;
  throw new Error(`Unsupported entity type: ${value}`);
}

function preferredAccountAlias(rows = []) {
  const order = new Map([
    ['PAYBILL_CODE', 0],
    ['ACCOUNT_NUMBER', 1],
    ['ACCOUNT', 2],
    ['WALLET_CODE', 3],
    ['VIRTUAL_ACCOUNT_CODE', 4],
  ]);
  return (rows || [])
    .filter((r) => r && r.alias)
    .sort((a, b) => (order.get(a.alias_type) ?? 99) - (order.get(b.alias_type) ?? 99))[0] || null;
}

async function loadWallet(entityType, entityId, { client } = {}) {
  const db = client || pool;
  const { rows } = await db.query(
    `
      SELECT id, entity_type, entity_id, wallet_code, virtual_account_code, balance, created_at
      FROM wallets
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [entityType, entityId],
  );
  return rows[0] || null;
}

async function loadAccountAlias(walletId, { client } = {}) {
  if (!walletId) return null;
  const db = client || pool;
  const { rows } = await db.query(
    `
      SELECT alias, alias_type
      FROM wallet_aliases
      WHERE wallet_id = $1
        AND is_active = true
        AND alias_type IN ('PAYBILL_CODE','ACCOUNT_NUMBER','ACCOUNT','WALLET_CODE','VIRTUAL_ACCOUNT_CODE')
    `,
    [walletId],
  );
  return preferredAccountAlias(rows);
}

async function resolveEntityWallet({ entityType, entityId, createIfMissing = true, client = null } = {}) {
  const normalizedType = normalizeEntityType(entityType);
  const db = client || pool;

  let wallet = await loadWallet(normalizedType, entityId, { client: db });

  if (!wallet && createIfMissing) {
    const walletKind = normalizedType === 'TAXI' ? 'TAXI_DRIVER' : 'BODA_RIDER';
    const paybillKey = normalizedType === 'TAXI' ? '40' : '50';
    await registerWalletForEntity({
      entityType: normalizedType,
      entityId,
      walletKind,
      paybillKey,
      attachToEntity: false,
    });
    wallet = await loadWallet(normalizedType, entityId, { client: db });
  }

  if (!wallet) return null;

  const alias = await loadAccountAlias(wallet.id, { client: db });
  const accountNumber = alias?.alias || wallet.wallet_code || wallet.virtual_account_code || null;

  return {
    wallet_id: wallet.id,
    account_number: accountNumber,
    wallet_code: wallet.wallet_code,
    virtual_account_code: wallet.virtual_account_code,
    paybill: PAYBILL_NUMBER,
    entity_type: normalizedType,
    entity_id: wallet.entity_id,
    balance: wallet.balance ?? null,
    created_at: wallet.created_at,
  };
}

module.exports = {
  resolveEntityWallet,
};
