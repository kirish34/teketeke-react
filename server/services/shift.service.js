const pool = require('../db/pool');
const { resolveActiveTripIdForMatatu } = require('./trip.service');

async function getActiveShift(matatuId, staffUserId) {
  if (!matatuId || !staffUserId) return null;
  const { rows } = await pool.query(
    `
      SELECT *
      FROM matatu_shifts
      WHERE matatu_id = $1
        AND staff_user_id = $2
        AND status = 'OPEN'
      ORDER BY opened_at DESC
      LIMIT 1
    `,
    [matatuId, staffUserId],
  );
  return rows[0] || null;
}

async function openShift(matatuId, staffUserId) {
  if (!matatuId || !staffUserId) throw new Error('matatu_id and staff_user_id required');
  const existing = await getActiveShift(matatuId, staffUserId);
  if (existing) return existing;
  const { rows } = await pool.query(
    `
      INSERT INTO matatu_shifts (matatu_id, staff_user_id, opening_balance)
      VALUES ($1, $2, 0)
      RETURNING *
    `,
    [matatuId, staffUserId],
  );
  return rows[0] || null;
}

async function closeShift(shiftId, actorUserId) {
  if (!shiftId) throw new Error('shift_id required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shiftRes = await client.query(`SELECT * FROM matatu_shifts WHERE id = $1 FOR UPDATE`, [shiftId]);
    const shift = shiftRes.rows[0] || null;
    if (!shift) throw new Error('shift not found');
    if (shift.status === 'CLOSED') {
      await client.query('COMMIT');
      return shift;
    }
    const ledgerSumRes = await client.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM wallet_ledger WHERE shift_id = $1 AND direction = 'CREDIT'`,
      [shiftId],
    );
    const totalCollected = Number(ledgerSumRes.rows[0]?.total || 0);
    const closingBalance = totalCollected;
    const depositAmount = closingBalance; // placeholder until allocations implemented

    const updated = await client.query(
      `
        UPDATE matatu_shifts
        SET status = 'CLOSED',
            closed_at = now(),
            total_collected = $2,
            closing_balance = $3,
            deposit_amount = $4
        WHERE id = $1
        RETURNING *
      `,
      [shiftId, totalCollected, closingBalance, depositAmount],
    );
    await client.query('COMMIT');
    return updated.rows[0] || shift;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resolveActiveShiftIdForMatatu(matatuId, staffUserId = null) {
  if (!matatuId) return null;
  const params = [matatuId];
  const where = ['matatu_id = $1', "status = 'OPEN'"];
  if (staffUserId) {
    params.push(staffUserId);
    where.push(`staff_user_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `
      SELECT id
      FROM matatu_shifts
      WHERE ${where.join(' AND ')}
      ORDER BY opened_at DESC
      LIMIT 1
    `,
    params,
  );
  return rows[0]?.id || null;
}

module.exports = {
  getActiveShift,
  openShift,
  closeShift,
  resolveActiveShiftIdForMatatu,
};
