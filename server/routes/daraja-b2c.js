const express = require('express');
const { supabaseAdmin } = require('../supabase');
const {
  ensureIdempotent,
  validateRequired,
  verifyShortcode,
  safeAck,
  logCallbackAudit,
} = require('../services/callbackHardening.service');

const router = express.Router();

if (!supabaseAdmin) {
  console.warn('Supabase service role missing; /daraja/b2c callbacks will no-op');
}

const CALLBACK_SECRET = process.env.B2C_CALLBACK_SECRET || process.env.DARAJA_WEBHOOK_SECRET || null;

function guard(req, res, next) {
  if (!CALLBACK_SECRET) return next();
  const got = req.headers['x-callback-secret'] || '';
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

function nowPlusSeconds(sec) {
  return new Date(Date.now() + (sec * 1000)).toISOString();
}

async function finalizePayout(payoutId, status, providerRef, reason) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.rpc('finalize_payout', {
    p_payout_id: payoutId,
    p_status: status,
    p_provider_reference: providerRef || null,
    p_failure_reason: reason || null,
  });
}

async function scheduleRetry(payoutId, reason, seconds = 60) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.rpc('schedule_payout_retry', {
    p_payout_id: payoutId,
    p_next_retry_at: nowPlusSeconds(seconds),
    p_error: reason || 'Daraja timeout',
  });
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

    if (resultCode === 0) {
      await finalizePayout(originator, 'paid', providerRef, null);
      console.log(`[B2C Callback] PAID payout=${originator} providerRef=${providerRef}`);
    } else {
      await finalizePayout(originator, 'failed', providerRef, `${resultDesc} (code=${resultCode})`);
      console.log(`[B2C Callback] FAILED payout=${originator} code=${resultCode} desc=${resultDesc}`);
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

    const idKey = originator || conversationId || null;
    const idem = await ensureIdempotent({
      kind: 'B2C_TIMEOUT',
      key: idKey || 'unknown-timeout',
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

    if (originator) {
      await scheduleRetry(originator, `Daraja timeout: ${resultDesc}`, 60);
      console.log(`[B2C Timeout] requeued payout=${originator} conv=${conversationId || 'n/a'}`);
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
