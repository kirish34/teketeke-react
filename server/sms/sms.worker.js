const pool = require('../db/pool');
const { sendSmsViaProvider } = require('./provider');

const BATCH_SIZE = 50;

async function sendPendingSmsBatch() {
  const client = await pool.connect();
  let rows = [];
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `
        update sms_messages
        set status = 'SENDING',
            tries = tries + 1,
            updated_at = now()
        where id in (
          select id
          from sms_messages
          where status = 'PENDING'
          order by created_at
          limit $1
          for update skip locked
        )
        returning *
      `,
      [BATCH_SIZE]
    );
    rows = res.rows;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error selecting SMS batch:', err.message);
  } finally {
    client.release();
  }

  if (!rows.length) return;

  for (const msg of rows) {
    try {
      const providerRes = await sendSmsViaProvider({
        toPhone: msg.to_phone,
        body: msg.body,
      });
      await pool.query(
        `
          update sms_messages
          set status = 'SENT',
              provider_message_id = $1,
              updated_at = now()
          where id = $2
        `,
        [providerRes.messageId || null, msg.id]
      );
    } catch (err) {
      console.error('Failed to send SMS', msg.id, err.message);
      await pool.query(
        `
          update sms_messages
          set status = 'FAILED',
              error_message = $1,
              updated_at = now()
          where id = $2
        `,
        [err.message, msg.id]
      );
    }
  }
}

module.exports = {
  sendPendingSmsBatch,
};
