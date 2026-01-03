const pool = require('../db/pool');

function checksumDigit(base6) {
  const raw = String(base6 || '');
  if (!/^\d{6}$/.test(raw)) {
    throw new Error('base6 must be exactly 6 digits');
  }

  let sum = 0;
  for (const ch of raw) {
    sum += Number(ch);
  }

  while (sum >= 10) {
    let next = 0;
    for (const ch of String(sum)) {
      next += Number(ch);
    }
    sum = next;
  }

  return String(sum);
}

function validatePaybillCode(code7) {
  const raw = String(code7 || '').trim();
  if (!/^\d{7}$/.test(raw)) return false;
  const base6 = raw.slice(0, 6);
  const check = raw.slice(6);
  try {
    return checksumDigit(base6) === check;
  } catch (err) {
    return false;
  }
}

async function allocatePaybillCode(key, { client } = {}) {
  if (!key) throw new Error('paybill key is required');
  const db = client || (await pool.connect());
  const ownTx = !client;

  try {
    if (ownTx) await db.query('BEGIN');

    const { rows } = await db.query(
      `
        SELECT key, prefix_digit, subtype_digit, next_seq
        FROM paybill_code_counters
        WHERE key = $1
        FOR UPDATE
      `,
      [key]
    );
    if (!rows.length) {
      throw new Error(`Unknown paybill counter key: ${key}`);
    }

    const row = rows[0];
    const seq = Number(row.next_seq || 0);
    if (!Number.isFinite(seq) || seq < 1 || seq > 9999) {
      throw new Error(`Paybill sequence exhausted for key ${key}`);
    }

    const seqStr = String(seq).padStart(4, '0');
    const base6 = `${row.prefix_digit}${row.subtype_digit}${seqStr}`;
    const code7 = `${base6}${checksumDigit(base6)}`;

    await db.query(
      `
        UPDATE paybill_code_counters
        SET next_seq = next_seq + 1,
            updated_at = now()
        WHERE key = $1
      `,
      [key]
    );

    if (ownTx) await db.query('COMMIT');
    return code7;
  } catch (err) {
    if (ownTx) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (ownTx) db.release();
  }
}

module.exports = {
  checksumDigit,
  validatePaybillCode,
  allocatePaybillCode,
};
