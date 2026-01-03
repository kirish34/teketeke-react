const pool = require('../db/pool');

async function createOpsAlert({
  type,
  severity = 'WARN',
  entity_type = null,
  entity_id = null,
  payment_id = null,
  message,
  meta = {},
  client = null,
}) {
  if (!type) throw new Error('ops alert type is required');
  if (!message) throw new Error('ops alert message is required');
  const db = client || pool;
  const payload = meta && typeof meta === 'object' ? meta : {};

  const { rows } = await db.query(
    `
      INSERT INTO ops_alerts
        (type, severity, entity_type, entity_id, payment_id, message, meta)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [type, severity, entity_type, entity_id, payment_id, message, payload]
  );

  return rows[0];
}

module.exports = {
  createOpsAlert,
};
