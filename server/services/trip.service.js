const pool = require('../db/pool');

async function resolveActiveTripIdForMatatu(matatuId) {
  if (!matatuId) return null;
  const { rows } = await pool.query(
    `
      SELECT id
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
  return rows[0]?.id || null;
}

module.exports = {
  resolveActiveTripIdForMatatu,
};
