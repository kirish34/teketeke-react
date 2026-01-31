const pool = require('../db/pool');

async function getInProgressTripForMatatu(matatuId) {
  if (!matatuId) return null;
  const { rows } = await pool.query(
    `
      SELECT *
      FROM matatu_trips
      WHERE matatu_id = $1
        AND status = 'IN_PROGRESS'
        AND started_at IS NOT NULL
        AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [matatuId],
  );
  return rows[0] || null;
}

async function resolveActiveTripIdForMatatu(matatuId) {
  const row = await getInProgressTripForMatatu(matatuId);
  return row?.id || null;
}

async function startTripForMatatu(matatuId, shiftId = null, actorUserId = null, startedBy = 'USER', autoStarted = false) {
  if (!matatuId) throw new Error('matatu_id required');
  // ensure only one in-progress trip per matatu
  const existing = await getInProgressTripForMatatu(matatuId);
  if (existing) return existing;

  // fetch sacco_id to satisfy NOT NULL
  const matatuRes = await pool.query(`SELECT id, sacco_id FROM matatus WHERE id = $1 LIMIT 1`, [matatuId]);
  const matatu = matatuRes.rows[0] || null;
  if (!matatu) throw new Error('matatu not found');

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO matatu_trips (sacco_id, matatu_id, shift_id, status, started_by_user_id, started_by, auto_started)
        VALUES ($1, $2, $3, 'IN_PROGRESS', $4, $5, $6)
        RETURNING *
      `,
      [matatu.sacco_id, matatu.id, shiftId || null, actorUserId || null, startedBy || 'USER', Boolean(autoStarted)],
    );
    return rows[0] || null;
  } catch (err) {
    const isConflict = err?.code === '23505' || /uniq_inprogress_trip_per_matatu/i.test(err?.detail || '');
    if (isConflict) {
      const existingTrip = await getInProgressTripForMatatu(matatuId);
      if (existingTrip) return existingTrip;
    }
    throw err;
  }
}

module.exports = {
  resolveActiveTripIdForMatatu,
  getInProgressTripForMatatu,
  startTripForMatatu,
};
