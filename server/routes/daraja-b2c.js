const express = require('express');
const { supabaseAdmin } = require('../supabase');

const router = express.Router();

if (!supabaseAdmin) {
  console.warn('Supabase service role missing; /daraja/b2c callbacks will no-op');
}

const CALLBACK_SECRET = process.env.B2C_CALLBACK_SECRET || process.env.DARAJA_WEBHOOK_SECRET || null;

function guard(req, res, next) {
  if (!CALLBACK_SECRET) return next();
  const got = req.headers['x-callback-secret'] || '';
  if (got !== CALLBACK_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });
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

    if (!originator) {
      console.warn('[B2C Callback] missing OriginatorConversationID');
      return res.json({ ok: true });
    }

    const providerRef = transactionId || conversationId || originator;

    if (resultCode === 0) {
      await finalizePayout(originator, 'paid', providerRef, null);
      console.log(`[B2C Callback] PAID payout=${originator} providerRef=${providerRef}`);
    } else {
      await finalizePayout(originator, 'failed', providerRef, `${resultDesc} (code=${resultCode})`);
      console.log(`[B2C Callback] FAILED payout=${originator} code=${resultCode} desc=${resultDesc}`);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[B2C Callback] error:', err.message);
    return res.json({ ok: true });
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

    if (originator) {
      await scheduleRetry(originator, `Daraja timeout: ${resultDesc}`, 60);
      console.log(`[B2C Timeout] requeued payout=${originator} conv=${conversationId || 'n/a'}`);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[B2C Timeout] error:', err.message);
    return res.json({ ok: true });
  }
});

module.exports = router;
