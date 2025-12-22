/**
 * Payout processor worker
 * - Polls approved payouts (maker-checker already done)
 * - Marks processing, sends B2C, finalizes paid/failed
 * - Uses Supabase service-role key and Daraja B2C credentials
 *
 * Run: node server/workers/payout-processor.js
 */

const axios = require('axios');
const { supabaseAdmin } = require('../supabase');

if (!supabaseAdmin) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required to run the payout processor');
  process.exit(1);
}

const POLL_INTERVAL_MS = Number(process.env.PAYOUT_POLL_INTERVAL_MS || 30000);
const BATCH_SIZE = Number(process.env.PAYOUT_BATCH_SIZE || 10);

const DARAJA_ENV = process.env.DARAJA_ENV || 'sandbox';
const BASE_URL = process.env.DARAJA_BASE_URL || (DARAJA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke');
const CONSUMER_KEY = process.env.DARAJA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.DARAJA_CONSUMER_SECRET || process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_B2C_SHORTCODE || process.env.DARAJA_SHORTCODE;
const INITIATOR = process.env.MPESA_B2C_INITIATOR_NAME || process.env.DARAJA_INITIATOR || process.env.DARAJA_B2C_INITIATOR_NAME;
const SECURITY_CREDENTIAL = process.env.MPESA_B2C_SECURITY_CREDENTIAL || process.env.DARAJA_B2C_SECURITY_CREDENTIAL;
const RESULT_URL = process.env.MPESA_B2C_RESULT_URL || process.env.DARAJA_CALLBACK_URL;
const TIMEOUT_URL = process.env.MPESA_B2C_TIMEOUT_URL || process.env.DARAJA_CALLBACK_URL;

function requireEnv(value, name) {
  if (!value) throw new Error(`${name} env is missing`);
  return value;
}

async function getAccessToken() {
  requireEnv(CONSUMER_KEY, 'DARAJA_CONSUMER_KEY');
  requireEnv(CONSUMER_SECRET, 'DARAJA_CONSUMER_SECRET');
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 10000,
  });
  return res.data.access_token;
}

function normalizeMsisdn(msisdn) {
  if (!msisdn) return null;
  const digits = String(msisdn).replace(/\D/g, '');
  if (digits.startsWith('0')) return '254' + digits.slice(1);
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('7')) return '254' + digits;
  return digits;
}

async function sendB2C({ payoutId, amount, phone }) {
  const token = await getAccessToken();
  const payload = {
    OriginatorConversationID: `PAYOUT-${payoutId}`,
    InitiatorName: requireEnv(INITIATOR, 'MPESA_B2C_INITIATOR_NAME'),
    SecurityCredential: requireEnv(SECURITY_CREDENTIAL, 'MPESA_B2C_SECURITY_CREDENTIAL'),
    CommandID: 'BusinessPayment',
    Amount: Number(amount),
    PartyA: requireEnv(SHORTCODE, 'MPESA_B2C_SHORTCODE'),
    PartyB: phone,
    Remarks: `TekeTeke payout ${payoutId}`,
    QueueTimeOutURL: requireEnv(TIMEOUT_URL, 'MPESA_B2C_TIMEOUT_URL'),
    ResultURL: requireEnv(RESULT_URL, 'MPESA_B2C_RESULT_URL'),
    Occasion: payoutId,
  };

  const res = await axios.post(`${BASE_URL}/mpesa/b2c/v1/paymentrequest`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  const data = res.data || {};
  return {
    providerRef: data.ConversationID || data.OriginatorConversationID || `PAYOUT-${payoutId}`,
    raw: data,
    ok: data.ResponseCode === '0' || res.status === 200,
    error: data.ResponseDescription || null,
  };
}

async function claimNext() {
  const { data, error } = await supabaseAdmin.rpc('claim_next_payout', {
    p_domain: 'teketeke',
    p_max_attempts: 8,
  });
  if (error) throw new Error(`claim_next_payout: ${error.message}`);
  return data;
}

function backoffSeconds(attempt) {
  const plan = [30, 120, 600, 1800, 7200, 21600]; // 30s, 2m, 10m, 30m, 2h, 6h
  const base = plan[Math.min(attempt - 1, plan.length - 1)] || 21600;
  const jitter = base * (0.2 * (Math.random() - 0.5)); // +/-20%
  return Math.max(30, base + jitter);
}

async function processOne(p) {
  // Mark processing (idempotent guard)
  const { error: markErr } = await supabaseAdmin.rpc('mark_payout_processing', {
    p_payout_id: p.id,
    p_provider_reference: p.id, // provisional ref
  });
  if (markErr) {
    console.warn(`[payout ${p.id}] skip: ${markErr.message}`);
    return;
  }

  const msisdn = normalizeMsisdn(p.destination_phone);
  if (!msisdn) {
    console.error(`[payout ${p.id}] invalid destination_phone`);
    await supabaseAdmin.rpc('finalize_payout', {
      p_payout_id: p.id,
      p_status: 'failed',
      p_provider_reference: p.id,
      p_failure_reason: 'Invalid destination phone',
    });
    return;
  }

  try {
    const res = await sendB2C({ payoutId: p.id, amount: p.amount, phone: msisdn });
    if (res.ok) {
      await supabaseAdmin.rpc('finalize_payout', {
        p_payout_id: p.id,
        p_status: 'paid',
        p_provider_reference: res.providerRef,
        p_failure_reason: null,
      });
      console.log(`[payout ${p.id}] paid ${p.amount} to ${msisdn}`);
    } else {
      await supabaseAdmin.rpc('finalize_payout', {
        p_payout_id: p.id,
        p_status: 'failed',
        p_provider_reference: res.providerRef,
        p_failure_reason: res.error || 'Provider failed',
      });
      console.error(`[payout ${p.id}] failed: ${res.error || 'provider failed'}`);
    }
  } catch (err) {
    console.error(`[payout ${p.id}] error sending B2C: ${err.message}`);
    // Schedule retry with backoff
    const nextSec = backoffSeconds(p.attempts || 1);
    const nextTime = new Date(Date.now() + nextSec * 1000).toISOString();
    const { error: retryErr } = await supabaseAdmin.rpc('schedule_payout_retry', {
      p_payout_id: p.id,
      p_next_retry_at: nextTime,
      p_error: err.message,
    });
    if (retryErr) {
      console.error(`[payout ${p.id}] failed to schedule retry: ${retryErr.message}`);
      await supabaseAdmin.rpc('finalize_payout', {
        p_payout_id: p.id,
        p_status: 'failed',
        p_provider_reference: p.id,
        p_failure_reason: err.message,
      });
    }
  }
}

async function processBatch() {
  let processed = 0;
  while (processed < BATCH_SIZE) {
    const job = await claimNext();
    if (!job || !job.id) break;
    await processOne(job);
    processed += 1;
  }
}

async function mainLoop() {
  console.log(`Payout processor started. Poll every ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}. Env=${DARAJA_ENV}`);
  // simple loop; consider adding advisory locks if you run multiple workers
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await processBatch();
    } catch (err) {
      console.error('Batch error:', err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

mainLoop().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
