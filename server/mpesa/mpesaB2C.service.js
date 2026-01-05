const axios = require('axios');
const pool = require('../db/pool');

const MPESA_BASE_URL =
  process.env.MPESA_BASE_URL ||
  (process.env.DARAJA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke');
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || process.env.DARAJA_CONSUMER_KEY;
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || process.env.DARAJA_CONSUMER_SECRET;
const MPESA_B2C_SHORTCODE = process.env.MPESA_B2C_SHORTCODE;
const MPESA_B2C_INITIATOR_NAME = process.env.MPESA_B2C_INITIATOR_NAME;
const MPESA_B2C_SECURITY_CREDENTIAL = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
const MPESA_B2C_RESULT_URL = process.env.MPESA_B2C_RESULT_URL;
const MPESA_B2C_TIMEOUT_URL = process.env.MPESA_B2C_TIMEOUT_URL;
const MPESA_B2C_PAYOUT_RESULT_URL = process.env.MPESA_B2C_PAYOUT_RESULT_URL || MPESA_B2C_RESULT_URL;
const MPESA_B2C_PAYOUT_TIMEOUT_URL = process.env.MPESA_B2C_PAYOUT_TIMEOUT_URL || MPESA_B2C_TIMEOUT_URL;

if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
  console.warn('M-Pesa consumer key/secret not set. B2C will fail until .env is configured.');
}

async function getAccessToken() {
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  return res.data.access_token;
}

function normalizeMsisdn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
}

/**
 * Send B2C payment for a withdrawal and update its status to PROCESSING.
 */
async function sendB2CPayment({ withdrawalId, amount, phoneNumber }) {
  if (!withdrawalId || !amount || !phoneNumber) {
    throw new Error('withdrawalId, amount, phoneNumber are required for B2C');
  }
  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new Error('MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET are not configured');
  }
  if (!MPESA_B2C_SHORTCODE || !MPESA_B2C_INITIATOR_NAME || !MPESA_B2C_SECURITY_CREDENTIAL) {
    throw new Error('B2C shortcode, initiator name, or security credential missing in env');
  }
  if (!MPESA_B2C_RESULT_URL || !MPESA_B2C_TIMEOUT_URL) {
    throw new Error('B2C result/timeout URLs missing in env');
  }

  const accessToken = await getAccessToken();

  const payload = {
    OriginatorConversationID: `WD-${withdrawalId}`,
    InitiatorName: MPESA_B2C_INITIATOR_NAME,
    SecurityCredential: MPESA_B2C_SECURITY_CREDENTIAL,
    CommandID: 'BusinessPayment',
    Amount: Number(amount),
    PartyA: MPESA_B2C_SHORTCODE,
    PartyB: phoneNumber,
    Remarks: `Withdrawal ${withdrawalId}`,
    QueueTimeOutURL: MPESA_B2C_TIMEOUT_URL,
    ResultURL: MPESA_B2C_RESULT_URL,
    Occasion: 'TekeTeke Wallet Withdrawal',
  };

  const res = await axios.post(`${MPESA_BASE_URL}/mpesa/b2c/v1/paymentrequest`, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  const responseData = res.data || {};
  const { ConversationID, OriginatorConversationID, ResponseCode, ResponseDescription } = responseData;

  await pool.query(
    `
      UPDATE withdrawals
      SET status = 'PROCESSING',
          mpesa_conversation_id = $1,
          mpesa_response = $2,
          updated_at = now()
      WHERE id = $3
    `,
    [ConversationID || OriginatorConversationID || null, responseData, withdrawalId]
  );

  return {
    withdrawalId,
    mpesa: {
      ConversationID,
      OriginatorConversationID,
      ResponseCode,
      ResponseDescription,
    },
  };
}

/**
 * Send B2C payment for a payout item (no DB writes).
 */
async function sendB2CPayout({ payoutItemId, amount, phoneNumber, idempotencyKey }) {
  if (!payoutItemId || !amount || !phoneNumber) {
    throw new Error('payoutItemId, amount, phoneNumber are required for B2C payout');
  }
  if (process.env.MPESA_B2C_MOCK === '1') {
    const originator = idempotencyKey || `PAYOUT-${payoutItemId}`;
    return {
      payoutItemId,
      providerRequestId: originator,
      conversationId: `MOCK-${payoutItemId}`,
      originatorConversationId: originator,
      response: { mocked: true },
    };
  }
  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new Error('MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET are not configured');
  }
  if (!MPESA_B2C_SHORTCODE || !MPESA_B2C_INITIATOR_NAME || !MPESA_B2C_SECURITY_CREDENTIAL) {
    throw new Error('B2C shortcode, initiator name, or security credential missing in env');
  }
  if (!MPESA_B2C_PAYOUT_RESULT_URL || !MPESA_B2C_PAYOUT_TIMEOUT_URL) {
    throw new Error('B2C payout result/timeout URLs missing in env');
  }

  const accessToken = await getAccessToken();
  const originator = idempotencyKey || `PAYOUT-${payoutItemId}`;
  const msisdn = normalizeMsisdn(phoneNumber);
  if (!msisdn) {
    throw new Error('Invalid MSISDN for payout');
  }

  const payload = {
    OriginatorConversationID: originator,
    InitiatorName: MPESA_B2C_INITIATOR_NAME,
    SecurityCredential: MPESA_B2C_SECURITY_CREDENTIAL,
    CommandID: 'BusinessPayment',
    Amount: Number(amount),
    PartyA: MPESA_B2C_SHORTCODE,
    PartyB: msisdn,
    Remarks: `SACCO payout ${payoutItemId}`,
    QueueTimeOutURL: MPESA_B2C_PAYOUT_TIMEOUT_URL,
    ResultURL: MPESA_B2C_PAYOUT_RESULT_URL,
    Occasion: `SACCO payout ${payoutItemId}`,
  };

  const res = await axios.post(`${MPESA_BASE_URL}/mpesa/b2c/v1/paymentrequest`, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  const responseData = res.data || {};
  const providerRequestId = responseData.OriginatorConversationID || originator;
  const conversationId = responseData.ConversationID || null;
  const originatorConversationId = responseData.OriginatorConversationID || originator;

  return {
    payoutItemId,
    providerRequestId,
    conversationId,
    originatorConversationId,
    response: responseData,
  };
}

module.exports = {
  sendB2CPayment,
  sendB2CPayout,
};
