const express = require('express');
const router = express.Router();

const pool = require('../db/pool');
const { creditFareWithFees } = require('../wallet/wallet.service');

/**
 * Normalize incoming M-Pesa callback payload.
 * Adjust the fields here if your provider sends a different shape.
 */
function parseMpesaCallback(body) {
  const mpesa_receipt =
    body.TransID ||
    body.transId ||
    (body.transaction && body.transaction.id) ||
    null;

  const amount =
    Number(
      body.TransAmount ||
      body.amount ||
      (body.transaction && body.transaction.amount) ||
      0
    );

  const phone_number =
    body.MSISDN ||
    body.msisdn ||
    body.customerNumber ||
    (body.sender && body.sender.phone) ||
    null;

  const paybill_number =
    body.BusinessShortCode ||
    body.businessShortCode ||
    body.shortCode ||
    null;

  // This ties M-Pesa payment to your internal wallet
  const account_reference =
    body.BillRefNumber ||
    body.AccountReference ||
    body.accountReference ||
    body.account_ref ||
    null;

  let transaction_timestamp = new Date();

  if (body.TransTime) {
    const t = String(body.TransTime);
    if (t.length === 14) {
      const year = t.slice(0, 4);
      const month = t.slice(4, 6);
      const day = t.slice(6, 8);
      const hour = t.slice(8, 10);
      const min = t.slice(10, 12);
      const sec = t.slice(12, 14);
      transaction_timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
    }
  }

  if (!account_reference) {
    throw new Error('account_reference (virtual_account_code) is missing in callback payload');
  }

  if (!amount || amount <= 0) {
    throw new Error('amount is missing or invalid in callback payload');
  }

  return {
    mpesa_receipt,
    amount,
    phone_number,
    paybill_number,
    account_reference,
    transaction_timestamp,
  };
}

/**
 * POST /mpesa/callback
 * - Store raw payload
 * - Credit wallet using account_reference as virtual_account_code
 * - Mark raw row as processed
 */
router.post('/callback', async (req, res) => {
  const body = req.body || {};

  console.log('Received M-Pesa callback:', JSON.stringify(body));

  const webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || null;
  if (webhookSecret) {
    const got = req.headers['x-webhook-secret'] || '';
    if (got !== webhookSecret) {
      console.warn('M-Pesa callback rejected: bad webhook secret');
      return res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
    }
  }

  let parsed;
  let rawId = null;

  try {
    parsed = parseMpesaCallback(body);
  } catch (err) {
    console.error('Failed to parse callback:', err.message);
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback received but parsing failed: ' + err.message,
    });
  }

  const {
    mpesa_receipt,
    amount,
    phone_number,
    paybill_number,
    account_reference,
    transaction_timestamp,
  } = parsed;

  try {
    // Idempotency: if we already processed this receipt, short-circuit
    if (mpesa_receipt) {
      const existing = await pool.query(
        `
          SELECT id, processed
          FROM paybill_payments_raw
          WHERE mpesa_receipt = $1
          LIMIT 1
        `,
        [mpesa_receipt]
      );
      if (existing.rows.length) {
        console.log('Duplicate callback ignored for receipt', mpesa_receipt);
        if (!existing.rows[0].processed && webhookSecret) {
          await pool.query(
            `UPDATE paybill_payments_raw SET processed = true, processed_at = now() WHERE id = $1`,
            [existing.rows[0].id]
          );
        }
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted (duplicate)' });
      }
    }

    // 1) Persist raw payload
    const insertRes = await pool.query(
      `
        INSERT INTO paybill_payments_raw
          (mpesa_receipt, phone_number, amount, paybill_number, account_reference, transaction_timestamp, raw_payload)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id;
      `,
      [
        mpesa_receipt,
        phone_number,
        amount,
        paybill_number,
        account_reference,
        transaction_timestamp,
        body,
      ]
    );

    rawId = insertRes.rows[0].id;
    console.log('Stored raw M-Pesa payment, id =', rawId);

    // 2) Credit wallet with fee splits
    const result = await creditFareWithFees({
      virtualAccountCode: account_reference,
      amount,
      source: 'MPESA_C2B',
      sourceRef: mpesa_receipt || String(rawId),
      description: `M-Pesa fare from ${phone_number || 'unknown'}`,
    });

    console.log(
      `Wallet credited: walletId=${result.walletId}, before=${result.balanceBefore}, after=${result.balanceAfter}`
    );

    // 3) Mark raw row as processed
    if (rawId) {
      await pool.query(
        `
          UPDATE paybill_payments_raw
          SET processed = true, processed_at = now()
          WHERE id = $1;
        `,
        [rawId]
      );
    }

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Accepted',
    });
  } catch (err) {
    console.error('Error handling M-Pesa callback:', err.message);

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback received but processing failed: ' + err.message,
    });
  }
});

/**
 * POST /mpesa/b2c-result
 * Updates withdrawals based on Daraja B2C result callback.
 */
router.post('/b2c-result', async (req, res) => {
  const body = req.body || {};
  console.log('Received M-Pesa B2C Result:', JSON.stringify(body));

  const webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || null;
  if (webhookSecret) {
    const got = req.headers['x-webhook-secret'] || '';
    if (got !== webhookSecret) {
      console.warn('B2C Result rejected: bad webhook secret');
      return res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
    }
  }

  try {
    const result = body.Result || {};
    const conversationId = result.ConversationID || result.OriginatorConversationID || null;
    const resultCode = result.ResultCode;
    const resultDesc = result.ResultDesc;

    if (!conversationId) {
      throw new Error('No ConversationID in B2C result');
    }

    const status = resultCode === 0 ? 'SUCCESS' : 'FAILED';

    await pool.query(
      `
        UPDATE withdrawals
        SET status = $1,
            mpesa_transaction_id = $2,
            mpesa_response = $3,
            failure_reason = CASE WHEN $1 = 'FAILED' THEN $4 ELSE failure_reason END,
            updated_at = now()
        WHERE mpesa_conversation_id = $5
      `,
      [
        status,
        result.TransactionID || null,
        body,
        resultDesc || null,
        conversationId,
      ]
    );

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'B2C Result processed successfully',
    });
  } catch (err) {
    console.error('Error processing B2C Result:', err.message);

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Result received but processing failed: ' + err.message,
    });
  }
});

module.exports = router;
