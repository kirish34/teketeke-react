const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

function getDateRange(query) {
  const now = new Date();
  const to = query.to ? new Date(query.to) : now;
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * GET /saccos/:saccoId/overview?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns SACCO-level totals.
 */
router.get('/saccos/:saccoId/overview', async (req, res) => {
  const { saccoId } = req.params;
  const { from, to } = getDateRange(req.query);

  try {
    const matatuNetRes = await pool.query(
      `
        SELECT
          s.id as sacco_id,
          s.name as sacco_name,
          COALESCE(SUM(wl.amount), 0) AS matatu_net
        FROM wallet_ledger wl
        JOIN wallets w
          ON w.id = wl.wallet_id
        JOIN matatus m
          ON m.id = w.entity_id
         AND w.entity_type = 'MATATU'
        JOIN saccos s
          ON s.id = m.sacco_id
        WHERE s.id = $1
          AND wl.direction = 'CREDIT'
          AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
          AND wl.created_at BETWEEN $2 AND $3
        GROUP BY s.id, s.name
      `,
      [saccoId, from.toISOString(), to.toISOString()]
    );

    const matatuNetRow = matatuNetRes.rows[0] || {
      sacco_id: saccoId,
      sacco_name: null,
      matatu_net: 0,
    };

    const saccoFeeRes = await pool.query(
      `
        SELECT
          COALESCE(SUM(wl.amount), 0) AS sacco_fee_income
        FROM wallet_ledger wl
        JOIN wallets w
          ON w.id = wl.wallet_id
        JOIN saccos s
          ON s.wallet_id = w.id
        WHERE s.id = $1
          AND wl.direction = 'CREDIT'
          AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
          AND wl.created_at BETWEEN $2 AND $3
      `,
      [saccoId, from.toISOString(), to.toISOString()]
    );

    const saccoFeeRow = saccoFeeRes.rows[0] || { sacco_fee_income: 0 };

    const platformFeeRes = await pool.query(
      `
        SELECT
          COALESCE(SUM(wl.amount), 0) AS platform_fee_income
        FROM wallet_ledger wl
        JOIN wallets w
          ON w.id = wl.wallet_id
        WHERE w.entity_type = 'SYSTEM'
          AND wl.direction = 'CREDIT'
          AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
          AND wl.created_at BETWEEN $1 AND $2
      `,
      [from.toISOString(), to.toISOString()]
    );

    const platformFeeRow = platformFeeRes.rows[0] || { platform_fee_income: 0 };

    const grossFares =
      Number(matatuNetRow.matatu_net || 0) +
      Number(saccoFeeRow.sacco_fee_income || 0) +
      Number(platformFeeRow.platform_fee_income || 0);

    return res.json({
      ok: true,
      sacco: {
        id: matatuNetRow.sacco_id,
        name: matatuNetRow.sacco_name,
      },
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      totals: {
        gross_fares: grossFares,
        matatu_net: Number(matatuNetRow.matatu_net || 0),
        sacco_fee_income: Number(saccoFeeRow.sacco_fee_income || 0),
        platform_fee_income: Number(platformFeeRow.platform_fee_income || 0),
      },
    });
  } catch (err) {
    console.error('Error in GET /saccos/:saccoId/overview:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /saccos/:saccoId/matatus/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Per-matatu breakdown for this SACCO.
 */
router.get('/saccos/:saccoId/matatus/summary', async (req, res) => {
  const { saccoId } = req.params;
  const { from, to } = getDateRange(req.query);

  try {
    const matatuRes = await pool.query(
      `
        SELECT
          m.id as matatu_id,
          m.plate as plate,
          COALESCE(SUM(wl.amount), 0) AS total_net,
          COUNT(wl.id)::int AS trips_count
        FROM wallet_ledger wl
        JOIN wallets w
          ON w.id = wl.wallet_id
        JOIN matatus m
          ON m.id = w.entity_id
         AND w.entity_type = 'MATATU'
        WHERE m.sacco_id = $1
          AND wl.direction = 'CREDIT'
          AND wl.entry_type IN ('C2B_CREDIT','STK_CREDIT')
          AND wl.created_at BETWEEN $2 AND $3
        GROUP BY m.id, m.plate
        ORDER BY total_net DESC
      `,
      [saccoId, from.toISOString(), to.toISOString()]
    );

    return res.json({
      ok: true,
      saccoId,
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      matatus: matatuRes.rows,
    });
  } catch (err) {
    console.error('Error in GET /saccos/:saccoId/matatus/summary:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
