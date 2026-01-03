const pool = require('../db/pool');

const DEFAULT_PAYBILL = '4814003';

function formatDateISO(date, timeZone = 'Africa/Nairobi') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

function resolveDateInput(dateStr) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return formatDateISO(new Date());
}

function buildNairobiRange(dateStr) {
  const safe = resolveDateInput(dateStr);
  const start = new Date(`${safe}T00:00:00+03:00`);
  const end = new Date(`${safe}T23:59:59.999+03:00`);
  return { date: safe, start, end };
}

async function runDailyReconciliation({ date, paybillNumber = DEFAULT_PAYBILL, client = null } = {}) {
  const db = client || pool;
  const { date: day, start, end } = buildNairobiRange(date);

  const baseTotalsSql = `
    SELECT
      COALESCE(SUM(CASE WHEN status = 'CREDITED' THEN COALESCE(amount, 0) ELSE 0 END), 0) AS credited_total,
      COUNT(*) FILTER (WHERE status = 'CREDITED') AS credited_count,
      COALESCE(SUM(CASE WHEN status = 'QUARANTINED' THEN COALESCE(amount, 0) ELSE 0 END), 0) AS quarantined_total,
      COUNT(*) FILTER (WHERE status = 'QUARANTINED') AS quarantined_count,
      COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN COALESCE(amount, 0) ELSE 0 END), 0) AS rejected_total,
      COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected_count
    FROM mpesa_c2b_payments
    WHERE created_at >= $1
      AND created_at <= $2
  `;

  const c2bRes = await db.query(
    `
      ${baseTotalsSql}
      AND paybill_number = $3
      AND checkout_request_id IS NULL
    `,
    [start.toISOString(), end.toISOString(), paybillNumber]
  );

  const stkRes = await db.query(
    `
      ${baseTotalsSql}
      AND checkout_request_id IS NOT NULL
    `,
    [start.toISOString(), end.toISOString()]
  );

  const c2bTotals = c2bRes.rows[0] || {};
  const stkTotals = stkRes.rows[0] || {};

  const upsertC2b = await db.query(
    `
      INSERT INTO reconciliation_daily
        (date, paybill_number, credited_total, credited_count, quarantined_total, quarantined_count, rejected_total, rejected_count)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (date)
      DO UPDATE SET
        paybill_number = EXCLUDED.paybill_number,
        credited_total = EXCLUDED.credited_total,
        credited_count = EXCLUDED.credited_count,
        quarantined_total = EXCLUDED.quarantined_total,
        quarantined_count = EXCLUDED.quarantined_count,
        rejected_total = EXCLUDED.rejected_total,
        rejected_count = EXCLUDED.rejected_count,
        updated_at = now()
      RETURNING *
    `,
    [
      day,
      paybillNumber,
      Number(c2bTotals.credited_total || 0),
      Number(c2bTotals.credited_count || 0),
      Number(c2bTotals.quarantined_total || 0),
      Number(c2bTotals.quarantined_count || 0),
      Number(c2bTotals.rejected_total || 0),
      Number(c2bTotals.rejected_count || 0),
    ]
  );

  const upsertChannel = async ({ channel, totals, channelPaybill }) => {
    const res = await db.query(
      `
        INSERT INTO reconciliation_daily_channels
          (date, channel, paybill_number, credited_total, credited_count, quarantined_total, quarantined_count, rejected_total, rejected_count)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (date, channel)
        DO UPDATE SET
          paybill_number = EXCLUDED.paybill_number,
          credited_total = EXCLUDED.credited_total,
          credited_count = EXCLUDED.credited_count,
          quarantined_total = EXCLUDED.quarantined_total,
          quarantined_count = EXCLUDED.quarantined_count,
          rejected_total = EXCLUDED.rejected_total,
          rejected_count = EXCLUDED.rejected_count,
          updated_at = now()
        RETURNING *
      `,
      [
        day,
        channel,
        channelPaybill || null,
        Number(totals.credited_total || 0),
        Number(totals.credited_count || 0),
        Number(totals.quarantined_total || 0),
        Number(totals.quarantined_count || 0),
        Number(totals.rejected_total || 0),
        Number(totals.rejected_count || 0),
      ]
    );
    return res.rows[0];
  };

  const channelC2b = await upsertChannel({ channel: 'C2B', totals: c2bTotals, channelPaybill: paybillNumber });
  const channelStk = await upsertChannel({ channel: 'STK', totals: stkTotals, channelPaybill: null });

  return {
    paybill_c2b: upsertC2b.rows[0],
    channels: [channelC2b, channelStk],
  };
}

module.exports = {
  formatDateISO,
  runDailyReconciliation,
  buildNairobiRange,
  resolveDateInput,
};
