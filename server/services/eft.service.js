const axios = require('axios');

const NCBA_BASE_URL = process.env.NCBA_BASE_URL || '';
const NCBA_CLIENT_ID = process.env.NCBA_CLIENT_ID || '';
const NCBA_CLIENT_SECRET = process.env.NCBA_CLIENT_SECRET || '';

async function getNcbaToken() {
  if (!NCBA_BASE_URL || !NCBA_CLIENT_ID || !NCBA_CLIENT_SECRET) {
    throw new Error('NCBA credentials are not configured');
  }
  const res = await axios.post(`${NCBA_BASE_URL}/oauth/token`, {
    client_id: NCBA_CLIENT_ID,
    client_secret: NCBA_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  return res.data.access_token;
}

/**
 * Placeholder EFT sender. Map payload to NCBA docs when available.
 */
async function sendEftTransfer({ amount, bankName, bankAccountNumber, bankAccountName, reference }) {
  const token = await getNcbaToken();
  const payload = {
    amount: Number(amount),
    currency: 'KES',
    beneficiaryBank: bankName,
    beneficiaryAccount: bankAccountNumber,
    beneficiaryName: bankAccountName,
    reference,
  };

  const res = await axios.post(
    `${NCBA_BASE_URL}/api/eft/transfer`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return res.data;
}

module.exports = {
  sendEftTransfer,
};
