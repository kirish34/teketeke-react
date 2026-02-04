const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const {
  ensureIdempotent,
  validateRequired,
  safeAck,
  logCallbackAudit,
} = require('../services/callbackHardening.service');

const router = express.Router();

const CALLBACK_SECRET = process.env.B2C_CALLBACK_SECRET || process.env.DARAJA_WEBHOOK_SECRET || null;

function guard(req, res, next) {
  if (!CALLBACK_SECRET) return next();
  const got = req.headers['x-callback-secret'] || '';
  if (!got) return next();
  if (got !== CALLBACK_SECRET) {
    logCallbackAudit({
      req,
      key: null,
      kind: 'B2C_CALLBACK',
      result: 'ignored',
      reason: 'secret_mismatch',
    });
    return safeAck(res, { ok: true, ignored: true, reason: 'secret_mismatch' });
  }
  return next();
}

function isWithdrawalOriginator(originator) {
  return Boolean(originator && String(originator).startsWith('WD-'));
}

function normalizeWithdrawalId(originator) {
  if (!originator) return null;
  const value = String(originator);
  if (value.startsWith('WD-')) return value.slice(3);
  return null;
}

function hashPayload(obj) {
  const raw = JSON.stringify(obj || {});
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function updateWithdrawalFromResult({
  originator,
  conversationId,
  transactionId,
  resultCode,
  resultDesc,
  rawBody,
}) {
  const withdrawalId = normalizeWithdrawalId(originator);
  if (!withdrawalId) return null;

  const status = Number(resultCode) === 0 ? 'SUCCESS' : 'FAILED';
  const failureReason = Number(resultCode) === 0 ? null : resultDesc || 'Provider failed';
  const res = await pool.query(
    `
      UPDATE withdrawals
      SET status = $1,
          mpesa_transaction_id = COALESCE($2, mpesa_transaction_id),
          mpesa_response = COALESCE($3, mpesa_response),
          failure_reason = CASE WHEN $1 = 'FAILED' THEN $4 ELSE failure_reason END,
          updated_at = now()
      WHERE (mpesa_conversation_id = $5 OR id = $6)
      RETURNING id
    `,
    [
      status,
      transactionId || null,
      rawBody || null,
      failureReason,
      conversationId || originator || null,
      withdrawalId,
    ],
  );
  return res.rows?.[0]?.id || null;
}

// Result callback
router.post('/daraja/b2c/result', guard, async (req, res) => {
  try {
    const body = req.body || {};
    const result = body.Result || body.result || body;
    const resultCode = Number(result.ResultCode ?? result.resultCode ?? -1);
    const resultDesc = result.ResultDesc ?? result.resultDesc ?? 'Unknown';
    const originator = result.OriginatorConversationID ?? result.originatorConversationID ?? null;
    const conversationId = result.ConversationID ?? result.conversationID ?? null;
    const transactionId = result.TransactionID ?? result.transactionID ?? null;

    const validation = validateRequired({ originator }, ['originator']);
    if (!validation.ok) {
      console.warn('[B2C Callback] missing OriginatorConversationID');
      await logCallbackAudit({
        req,
        key: conversationId || originator || transactionId || null,
        kind: 'B2C_RESULT',
        result: 'ignored',
        reason: 'invalid_payload',
      });
      return safeAck(res, { ok: true, ignored: true, reason: 'invalid_payload' });
    }

    const providerRef = transactionId || conversationId || originator;
    const isWithdrawal = isWithdrawalOriginator(originator);

    const idem = await ensureIdempotent({
      kind: 'B2C_RESULT',
      key: providerRef,
      payload: { resultCode, originator, conversationId, transactionId },
    });
    if (!idem.firstTime) {
      await logCallbackAudit({
        req,
        key: providerRef,
        kind: 'B2C_RESULT',
        result: 'ignored',
        reason: 'duplicate',
      });
      return safeAck(res, { ok: true, duplicate_ignored: true });
    }

    if (!isWithdrawal) {
      await logCallbackAudit({
        req,
        key: providerRef,
        kind: 'B2C_RESULT',
        result: 'ignored',
        reason: 'unknown_originator',
        payload: { originator },
      });
      return safeAck(res, { ok: true, ignored: true, reason: 'unknown_originator' });
    }

    const withdrawalUpdated = await updateWithdrawalFromResult({
      originator,
      conversationId,
      transactionId,
      resultCode,
      resultDesc,
      rawBody: body,
    });
    if (withdrawalUpdated) {
      console.log(`[B2C Callback] Withdrawal updated id=${withdrawalUpdated} providerRef=${providerRef}`);
    }

    await logCallbackAudit({
      req,
      key: providerRef,
      kind: 'B2C_RESULT',
      result: 'accepted',
    });
    return safeAck(res, { ok: true });
  } catch (err) {
    console.error('[B2C Callback] error:', err.message);
    await logCallbackAudit({
      req,
      key: null,
      kind: 'B2C_RESULT',
      result: 'rejected',
      reason: 'server_error',
      payload: { error: err.message },
    });
    return safeAck(res, { ok: true, accepted: false, error: 'server_error' });
  }
});

// Timeout callback
router.post('/daraja/b2c/timeout', guard, async (req, res) => {
  try {
    const body = req.body || {};
    const result = body.Result || body.result || body;
    const originator = result.OriginatorConversationID ?? result.originatorConversationID ?? null;
    const conversationId = result.ConversationID ?? result.conversationID ?? null;
    const resultDesc = result.ResultDesc ?? result.resultDesc ?? 'Queue timeout';

    const idKey = originator || conversationId || `timeout:${hashPayload(body).slice(0, 24)}`;
    const idem = await ensureIdempotent({
      kind: 'B2C_TIMEOUT',
      key: idKey,
      payload: { originator, conversationId, resultDesc },
    });
    if (!idem.firstTime) {
      await logCallbackAudit({
        req,
        key: idKey || 'unknown-timeout',
        kind: 'B2C_TIMEOUT',
        result: 'ignored',
        reason: 'duplicate',
      });
      return safeAck(res, { ok: true, duplicate_ignored: true });
    }

    await logCallbackAudit({
      req,
      key: idKey || 'unknown-timeout',
      kind: 'B2C_TIMEOUT',
      result: 'accepted',
    });

    return safeAck(res, { ok: true });
  } catch (err) {
    console.error('[B2C Timeout] error:', err.message);
    await logCallbackAudit({
      req,
      key: null,
      kind: 'B2C_TIMEOUT',
      result: 'rejected',
      reason: 'server_error',
      payload: { error: err.message },
    });
    return safeAck(res, { ok: true, accepted: false, error: 'server_error' });
  }
});

module.exports = router;
