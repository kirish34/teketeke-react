const pool = require('../db/pool');
const { allocatePaybillCode, validatePaybillCode } = require('./paybillCode.util');

function normalizeRef(ref) {
  return String(ref || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isNumericRef(ref) {
  return /^\d{7}$/.test(ref);
}

function isPlateRef(ref) {
  return /^[A-Z]{3}\d{3}[A-Z]$/.test(ref);
}

async function resolveWalletByRef(ref, { client } = {}) {
  const normalized = normalizeRef(ref);
  if (!normalized) return null;

  let aliasType = null;
  if (isNumericRef(normalized) && validatePaybillCode(normalized)) aliasType = 'PAYBILL_CODE';
  if (isPlateRef(normalized)) aliasType = aliasType || 'PLATE';
  if (!aliasType) return null;

  const db = client || pool;
  const { rows } = await db.query(
    `
      SELECT wallet_id
      FROM wallet_aliases
      WHERE alias = $1
        AND alias_type = $2
        AND is_active = true
      LIMIT 1
    `,
    [normalized, aliasType]
  );
  return rows[0]?.wallet_id || null;
}

async function ensurePlateAlias({ walletId, plate, client } = {}) {
  if (!walletId) throw new Error('walletId is required');
  const normalized = normalizeRef(plate);
  if (!isPlateRef(normalized)) {
    throw new Error(`Invalid plate alias: ${plate}`);
  }

  const db = client || pool;

  const existing = await db.query(
    `
      SELECT id, alias, is_active, wallet_id
      FROM wallet_aliases
      WHERE alias = $1 AND alias_type = 'PLATE'
      LIMIT 1
    `,
    [normalized]
  );

  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.wallet_id !== walletId) {
      throw new Error(`Plate alias already mapped to a different wallet (${normalized})`);
    }
    if (!row.is_active) {
      await db.query(`UPDATE wallet_aliases SET is_active = true WHERE id = $1`, [row.id]);
    }
  } else {
    await db.query(
      `
        INSERT INTO wallet_aliases (wallet_id, alias, alias_type, is_active)
        VALUES ($1, $2, 'PLATE', true)
      `,
      [walletId, normalized]
    );
  }

  await db.query(
    `
      UPDATE wallet_aliases
      SET is_active = false
      WHERE wallet_id = $1
        AND alias_type = 'PLATE'
        AND alias <> $2
        AND is_active = true
    `,
    [walletId, normalized]
  );

  return normalized;
}

async function ensurePaybillAlias({ walletId, key, client } = {}) {
  if (!walletId) throw new Error('walletId is required');
  if (!key) throw new Error('paybill key is required');
  const db = client || pool;

  const existing = await db.query(
    `
      SELECT id, alias, is_active
      FROM wallet_aliases
      WHERE wallet_id = $1 AND alias_type = 'PAYBILL_CODE'
      LIMIT 1
    `,
    [walletId]
  );

  if (existing.rows.length) {
    const row = existing.rows[0];
    if (!row.is_active) {
      await db.query(`UPDATE wallet_aliases SET is_active = true WHERE id = $1`, [row.id]);
    }
    return row.alias;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = await allocatePaybillCode(key, { client });
    const savepoint = `paybill_alias_${attempt}`;
    if (client) {
      await db.query(`SAVEPOINT ${savepoint}`);
    }
    try {
      const insert = await db.query(
        `
          INSERT INTO wallet_aliases (wallet_id, alias, alias_type, is_active)
          VALUES ($1, $2, 'PAYBILL_CODE', true)
          RETURNING alias
        `,
        [walletId, candidate]
      );
      if (client) {
        await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
      return insert.rows[0].alias;
    } catch (err) {
      if (client) {
        await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) continue;
      throw err;
    }
  }

  throw new Error('Could not generate unique PAYBILL_CODE alias');
}

async function ensureWalletAliasesForMatatu({ walletId, plate, client, paybillKey = '11' } = {}) {
  if (!walletId) throw new Error('walletId is required');
  await ensurePaybillAlias({ walletId, client, key: paybillKey });
  if (plate) {
    const normalized = normalizeRef(plate);
    if (isPlateRef(normalized)) {
      await ensurePlateAlias({ walletId, plate: normalized, client });
    } else {
      console.warn(`Skipping plate alias (invalid format): ${plate}`);
    }
  }
}

module.exports = {
  normalizeRef,
  isNumericRef,
  isPlateRef,
  resolveWalletByRef,
  ensurePlateAlias,
  ensurePaybillAlias,
  ensureWalletAliasesForMatatu,
};
