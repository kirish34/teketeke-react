const express = require('express');
const pool = require('../db/pool');
const { requireUser } = require('../middleware/auth');
const { resolveMatatuAccess } = require('../services/matatuAccess.service');

const router = express.Router();

router.use(requireUser);

function logLivePaymentsDebug(payload) {
  const enabled =
    String(process.env.DEBUG_MATATU_LIVE_PAYMENTS || '').toLowerCase() === 'true' ||
    String(process.env.DEBUG_MATATU_LIVE_PAYMENTS || '') === '1' ||
    String(process.env.DEBUG_LIVE_PAYMENTS || '').toLowerCase() === 'true' ||
    String(process.env.DEBUG_LIVE_PAYMENTS || '') === '1';
  if (!enabled) return;
  try {
    console.log('[matatu-live-payments]', payload);
  } catch {
    /* ignore */
  }
}

function normalizeFrom(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeLimit(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 50;
  return Math.min(Math.max(Math.floor(num), 1), 200);
}

router.get('/live-payments', async (req, res) => {
  const matatuId = (req.query.matatu_id || '').toString().trim();
  const limit = normalizeLimit(req.query.limit);
  const from = normalizeFrom(req.query.from) || new Date(Date.now() - 15 * 60 * 1000);

  if (!matatuId) {
    return res.status(400).json({
      ok: false,
      error: 'matatu_id required',
      request_id: req.requestId || null,
      code: 'MATATU_ID_REQUIRED',
    });
  }

  try {
    const access = await resolveMatatuAccess({
      userId: req.user?.id,
      matatuId,
      pool,
      requestId: req.requestId || null,
    });

    if (!access.ok) {
      logLivePaymentsDebug({
        request_id: req.requestId || null,
        user_id: req.user?.id || null,
        role: access.details?.role || null,
        matatu_id: matatuId,
        ...access.details,
        reason: 'access_denied',
      });
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'MATATU_ACCESS_DENIED',
        request_id: req.requestId || null,
        details: {
          user_id: req.user?.id || null,
          role: access.details?.role || null,
          requested_matatu_id: matatuId,
          grantExists: access.details?.grantExists,
          assignmentExists: access.details?.assignmentExists,
          profileAssign: access.details?.profileAssign,
        },
      });
    }

    const params = [matatuId, from.toISOString(), limit];
    const { rows } = await pool.query(
      `
        SELECT
          p.id,
          COALESCE(p.received_at, p.created_at) AS received_at,
          p.created_at,
          p.amount,
          COALESCE(p.display_msisdn, p.msisdn_normalized, p.msisdn) AS msisdn,
          p.account_reference,
          p.receipt,
          p.status,
          p.match_status,
          COALESCE(w_alias.wallet_kind, w_match.wallet_kind) AS wallet_kind
        FROM mpesa_c2b_payments p
        LEFT JOIN wallet_aliases wa
          ON wa.alias = p.account_reference
         AND wa.is_active = true
        LEFT JOIN wallets w_alias
          ON w_alias.id = wa.wallet_id
        LEFT JOIN wallets w_match
          ON w_match.id = p.matched_wallet_id
        WHERE (w_alias.matatu_id = $1 OR w_match.matatu_id = $1)
          AND COALESCE(p.received_at, p.created_at) >= $2
        ORDER BY COALESCE(p.received_at, p.created_at) DESC
        LIMIT $3
      `,
      params,
    );

    logLivePaymentsDebug({
      request_id: req.requestId || null,
      matatu_id: matatuId,
      from: from.toISOString(),
      limit,
      rowcount: rows.length,
    });

    return res.json({
      ok: true,
      matatu_id: matatuId,
      from: from.toISOString(),
      payments: rows || [],
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

router.get('/my-assignment', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'unauthorized', request_id: req.requestId || null });
    }

    const staffAssign = await pool.query(
      `
        SELECT matatu_id, sacco_id
        FROM matatu_staff_assignments
        WHERE staff_user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [userId],
    );
    const assignRow = staffAssign.rows[0] || null;

    let matatuId = assignRow?.matatu_id || null;
    let saccoId = assignRow?.sacco_id || null;

    if (!matatuId) {
      const prof = await pool.query(
        `SELECT matatu_id, sacco_id FROM staff_profiles WHERE user_id = $1 LIMIT 1`,
        [userId],
      );
      if (prof.rows.length) {
        matatuId = prof.rows[0].matatu_id || matatuId;
        saccoId = saccoId || prof.rows[0].sacco_id || null;
      }
    }

    if (!matatuId) {
      const grant = await pool.query(
        `
          SELECT scope_id AS matatu_id
          FROM access_grants
          WHERE user_id = $1
            AND scope_type IN ('OWNER','MATATU')
            AND is_active = true
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId],
      );
      if (grant.rows.length) {
        matatuId = grant.rows[0].matatu_id || matatuId;
      }
    }

    return res.json({
      ok: true,
      user_id: userId,
      role: req.user?.role || null,
      matatu_id: matatuId || null,
      sacco_id: saccoId || null,
      request_id: req.requestId || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to resolve assignment',
      request_id: req.requestId || null,
    });
  }
});

module.exports = router;
