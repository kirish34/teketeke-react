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

module.exports = {
  sendB2CPayment,
};
