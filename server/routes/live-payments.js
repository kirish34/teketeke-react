const express = require('express');
const pool = require('../db/pool');
const { requireUser } = require('../middleware/auth');
const { requireSaccoMembership } = require('../services/saccoAuth.service');
const { extractSenderNameFromRaw } = require('../utils/msisdn');

const router = express.Router();

router.use(requireUser);
router.use(requireSaccoMembership({ allowRoles: ['SACCO_ADMIN', 'SYSTEM_ADMIN'], allowStaff: true }));

function logLivePaymentsDebug(payload) {
  if (String(process.env.DEBUG_LIVE_PAYMENTS || '').toLowerCase() !== '1') return;
  try {
    console.log('[live-payments]', payload);
  } catch {
    /* no-op */
  }
}

function parseFrom(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeLimit(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 50;
  return Math.min(Math.max(Math.floor(num), 1), 200);
}

router.get('/live-payments', async (req, res) => {
  const saccoId = req.saccoId;
  const limit = normalizeLimit(req.query.limit);
  const from = parseFrom(req.query.from) || new Date(Date.now() - 15 * 60 * 1000);
  if (!saccoId) {
    return res.status(400).json({
      ok: false,
      error: 'sacco_id required',
      request_id: req.requestId || null,
    });
  }

  try {
    const params = [saccoId, from.toISOString(), limit];
    const { rows } = await pool.query(
      `
        SELECT
          p.id,
          COALESCE(p.trans_time, p.created_at) AS received_at,
          p.created_at,
          p.amount,
          COALESCE(p.display_msisdn, p.msisdn_normalized, p.msisdn) AS msisdn,
          p.account_reference,
          p.receipt,
          p.status,
          p.match_status,
          COALESCE(w_alias.wallet_kind, w_match.wallet_kind) AS wallet_kind,
          p.raw,
          p.raw_payload
        FROM mpesa_c2b_payments p
        LEFT JOIN wallet_aliases wa
          ON wa.alias = p.account_reference
         AND wa.is_active = true
        LEFT JOIN wallets w_alias
          ON w_alias.id = wa.wallet_id
        LEFT JOIN wallets w_match
          ON w_match.id = p.matched_wallet_id
        WHERE (w_alias.sacco_id = $1 OR w_match.sacco_id = $1)
          AND COALESCE(p.trans_time, p.created_at) >= $2
        ORDER BY COALESCE(p.trans_time, p.created_at) DESC
        LIMIT $3
      `,
      params,
    );

    logLivePaymentsDebug({
      request_id: req.requestId || null,
      sacco_id: saccoId,
      from: from.toISOString(),
      limit,
      rowcount: rows.length,
    });

    const payments = (rows || []).map(({ raw, raw_payload, ...rest }) => ({
      ...rest,
      sender_name: extractSenderNameFromRaw(raw || raw_payload),
    }));

    return res.json({
      ok: true,
      sacco_id: saccoId,
      server_time: new Date().toISOString(),
      payments,
      request_id: req.requestId || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to load live payments',
      request_id: req.requestId || null,
    });
  }
});

module.exports = router;
