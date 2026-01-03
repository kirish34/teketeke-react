const express = require('express');
const router = express.Router();

const pool = require('../db/pool');
const { creditFareWithFeesByWalletId } = require('../wallet/wallet.service');
const { normalizeRef, resolveWalletByRef } = require('../wallet/wallet.aliases');
const { validatePaybillCode } = require('../wallet/paybillCode.util');
const { applyRiskRules } = require('../mpesa/c2bRisk');

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
  const got = req.headers['x-webhook-secret'] || '';
  const secretMismatch = webhookSecret ? got !== webhookSecret : false;

  let parsed;
  let parseError = null;

  try {
    parsed = parseMpesaCallback(body);
  } catch (err) {
    parseError = err;
    parsed = null;
  }

  const mpesa_receipt = parsed?.mpesa_receipt || null;
  const amount = parsed?.amount;
  const phone_number = parsed?.phone_number || null;
  const paybill_number = parsed?.paybill_number || null;
  const account_reference = parsed?.account_reference || null;
  const normalizedRef = normalizeRef(account_reference);
  const expectedPaybill = '4814003';
  const amountNumber = Number(amount);
  const amountValue = Number.isFinite(amountNumber) ? amountNumber : 0;

  if (secretMismatch) {
    console.warn('M-Pesa callback rejected: bad webhook secret');
    try {
      let paymentId = null;
      let paymentStatus = null;

      if (mpesa_receipt) {
        const upsertRes = await pool.query(
          `
            INSERT INTO mpesa_c2b_payments
              (paybill_number, account_reference, amount, msisdn, receipt, status, raw)
            VALUES
              ($1, $2, $3, $4, $5, 'QUARANTINED', $6)
            ON CONFLICT (receipt) DO UPDATE
              SET paybill_number = EXCLUDED.paybill_number,
                  account_reference = EXCLUDED.account_reference,
                  amount = EXCLUDED.amount,
                  msisdn = EXCLUDED.msisdn,
                  raw = EXCLUDED.raw,
                  status = CASE
                    WHEN mpesa_c2b_payments.status IN ('CREDITED', 'REJECTED', 'QUARANTINED')
                      THEN mpesa_c2b_payments.status
                    ELSE 'QUARANTINED'
                  END
            RETURNING id, status
          `,
          [
            paybill_number || null,
            normalizedRef || null,
            amountValue,
            phone_number || null,
            mpesa_receipt || null,
            body,
          ]
        );
        paymentId = upsertRes.rows[0]?.id || null;
        paymentStatus = upsertRes.rows[0]?.status || null;
      } else {
        const insertRes = await pool.query(
          `
            INSERT INTO mpesa_c2b_payments
              (paybill_number, account_reference, amount, msisdn, receipt, status, raw)
            VALUES
              ($1, $2, $3, $4, $5, 'QUARANTINED', $6)
            RETURNING id, status
          `,
          [
            paybill_number || null,
            normalizedRef || null,
            amountValue,
            phone_number || null,
            mpesa_receipt || null,
            body,
          ]
        );
        paymentId = insertRes.rows[0]?.id || null;
        paymentStatus = insertRes.rows[0]?.status || null;
      }

      if (paymentStatus === 'QUARANTINED' || paymentStatus === 'RECEIVED') {
        await pool.query(
          `
            INSERT INTO mpesa_c2b_quarantine
              (paybill_number, account_reference, amount, msisdn, raw, reason)
            VALUES
              ($1, $2, $3, $4, $5, 'WEBHOOK_SECRET_MISMATCH')
          `,
          [paybill_number || null, normalizedRef || null, amountValue, phone_number || null, body]
        );
      }

      if (paymentId) {
        try {
          await applyRiskRules({ paymentId, reasonCodes: ['WEBHOOK_SECRET_MISMATCH'] });
        } catch (err) {
          console.warn('Risk engine failed for webhook secret mismatch:', err.message);
        }
      }
    } catch (err) {
      console.warn('Failed to quarantine webhook secret mismatch:', err.message);
    }

    return res.status(200).json({ ok: true });
  }

  if (parseError) {
    console.error('Failed to parse callback:', parseError.message);
    return res.status(200).json({ ok: true });
  }

  try {
    let paymentId = null;
    let paymentStatus = null;

    if (mpesa_receipt) {
      const upsertRes = await pool.query(
        `
          INSERT INTO mpesa_c2b_payments
            (paybill_number, account_reference, amount, msisdn, receipt, status, raw)
          VALUES
            ($1, $2, $3, $4, $5, 'RECEIVED', $6)
          ON CONFLICT (receipt) DO UPDATE
            SET paybill_number = EXCLUDED.paybill_number,
                account_reference = EXCLUDED.account_reference,
                amount = EXCLUDED.amount,
                msisdn = EXCLUDED.msisdn,
                raw = EXCLUDED.raw
          RETURNING id, status
        `,
        [
          paybill_number || null,
          normalizedRef || null,
          amountValue,
          phone_number || null,
          mpesa_receipt || null,
          body,
        ]
      );
      paymentId = upsertRes.rows[0].id;
      paymentStatus = upsertRes.rows[0].status;
    } else {
      const insertRes = await pool.query(
        `
          INSERT INTO mpesa_c2b_payments
            (paybill_number, account_reference, amount, msisdn, receipt, status, raw)
          VALUES
            ($1, $2, $3, $4, $5, 'RECEIVED', $6)
          RETURNING id, status
        `,
        [
          paybill_number || null,
          normalizedRef || null,
          amountValue,
          phone_number || null,
          mpesa_receipt || null,
          body,
        ]
      );
      paymentId = insertRes.rows[0].id;
      paymentStatus = insertRes.rows[0].status;
    }

    if (paymentStatus && paymentStatus !== 'RECEIVED') {
      console.log('Duplicate callback ignored for receipt', mpesa_receipt || paymentId);
      try {
        await applyRiskRules({ paymentId, reasonCodes: ['DUPLICATE_RECEIPT'] });
      } catch (err) {
        console.warn('Risk engine failed for duplicate receipt:', err.message);
      }
      return res.status(200).json({ ok: true });
    }

    if (String(paybill_number || '') !== expectedPaybill) {
      console.warn('ALERT: C2B paybill mismatch', {
        receipt: mpesa_receipt || null,
        paybill_number,
        account_reference: normalizedRef || null,
      });
      const updateRes = await pool.query(
        `
          UPDATE mpesa_c2b_payments
          SET status = 'QUARANTINED'
          WHERE id = $1 AND status = 'RECEIVED'
        `,
        [paymentId]
      );
      if (updateRes.rowCount) {
        await pool.query(
          `
            INSERT INTO mpesa_c2b_quarantine
              (paybill_number, account_reference, amount, msisdn, raw, reason)
            VALUES
              ($1, $2, $3, $4, $5, 'PAYBILL_MISMATCH')
          `,
          [paybill_number || null, normalizedRef || null, amountValue, phone_number || null, body]
        );
      }
      try {
        await applyRiskRules({ paymentId, reasonCodes: ['PAYBILL_MISMATCH'] });
      } catch (err) {
        console.warn('Risk engine failed for paybill mismatch:', err.message);
      }
      return res.status(200).json({ ok: true });
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      console.warn('ALERT: C2B invalid amount', {
        receipt: mpesa_receipt || null,
        amount,
        account_reference: normalizedRef || null,
      });
      const updateRes = await pool.query(
        `
          UPDATE mpesa_c2b_payments
          SET status = 'QUARANTINED'
          WHERE id = $1 AND status = 'RECEIVED'
        `,
        [paymentId]
      );
      if (updateRes.rowCount) {
        await pool.query(
          `
            INSERT INTO mpesa_c2b_quarantine
              (paybill_number, account_reference, amount, msisdn, raw, reason)
            VALUES
              ($1, $2, $3, $4, $5, 'INVALID_AMOUNT')
          `,
          [paybill_number || null, normalizedRef || null, amountValue, phone_number || null, body]
        );
      }
      try {
        await applyRiskRules({ paymentId, reasonCodes: [] });
      } catch (err) {
        console.warn('Risk engine failed for invalid amount:', err.message);
      }
      return res.status(200).json({ ok: true });
    }

    if (!validatePaybillCode(normalizedRef)) {
      console.warn('ALERT: C2B invalid checksum account reference', {
        receipt: mpesa_receipt || null,
        account_reference: normalizedRef || null,
      });
      const updateRes = await pool.query(
        `
          UPDATE mpesa_c2b_payments
          SET status = 'QUARANTINED'
          WHERE id = $1 AND status = 'RECEIVED'
        `,
        [paymentId]
      );
      if (updateRes.rowCount) {
        await pool.query(
          `
            INSERT INTO mpesa_c2b_quarantine
              (paybill_number, account_reference, amount, msisdn, raw, reason)
            VALUES
              ($1, $2, $3, $4, $5, 'INVALID_CHECKSUM_REF')
          `,
          [paybill_number || null, normalizedRef || null, amountNumber, phone_number || null, body]
        );
      }
      try {
        await applyRiskRules({ paymentId, reasonCodes: ['INVALID_CHECKSUM_REF'] });
      } catch (err) {
        console.warn('Risk engine failed for invalid checksum reference:', err.message);
      }
      return res.status(200).json({ ok: true });
    }

    const walletId = await resolveWalletByRef(normalizedRef);
    if (!walletId) {
      console.warn('ALERT: C2B unknown account reference', {
        receipt: mpesa_receipt || null,
        account_reference: normalizedRef || null,
      });
      const updateRes = await pool.query(
        `
          UPDATE mpesa_c2b_payments
          SET status = 'QUARANTINED'
          WHERE id = $1 AND status = 'RECEIVED'
        `,
        [paymentId]
      );
      if (updateRes.rowCount) {
        await pool.query(
          `
            INSERT INTO mpesa_c2b_quarantine
              (paybill_number, account_reference, amount, msisdn, raw, reason)
            VALUES
              ($1, $2, $3, $4, $5, 'UNKNOWN_ACCOUNT_REF')
          `,
          [paybill_number || null, normalizedRef || null, amountNumber, phone_number || null, body]
        );
      }
      try {
        await applyRiskRules({ paymentId, reasonCodes: ['UNKNOWN_ACCOUNT_REF'] });
      } catch (err) {
        console.warn('Risk engine failed for unknown account reference:', err.message);
      }
      return res.status(200).json({ ok: true });
    }

    let riskResult = null;
    try {
      riskResult = await applyRiskRules({ paymentId, reasonCodes: [] });
    } catch (err) {
      console.warn('Risk engine failed for C2B payment:', err.message);
    }

    if (riskResult && riskResult.risk_level === 'HIGH') {
      const updateRes = await pool.query(
        `
          UPDATE mpesa_c2b_payments
          SET status = 'QUARANTINED'
          WHERE id = $1 AND status = 'RECEIVED'
        `,
        [paymentId]
      );
      if (updateRes.rowCount) {
        await pool.query(
          `
            INSERT INTO mpesa_c2b_quarantine
              (paybill_number, account_reference, amount, msisdn, raw, reason)
            VALUES
              ($1, $2, $3, $4, $5, 'HIGH_RISK')
          `,
          [paybill_number || null, normalizedRef || null, amountNumber, phone_number || null, body]
        );
      }
      return res.status(200).json({ ok: true });
    }

    const sourceRef = mpesa_receipt || String(paymentId);
    const existingTx = await pool.query(
      `
        SELECT id
        FROM wallet_transactions
        WHERE source = 'MPESA_C2B' AND source_ref = $1
        LIMIT 1
      `,
      [sourceRef]
    );
    if (existingTx.rows.length) {
      await pool.query(
        `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status = 'RECEIVED'`,
        [paymentId]
      );
      try {
        await applyRiskRules({ paymentId, reasonCodes: ['IDEMPOTENT_REPLAY'] });
      } catch (err) {
        console.warn('Risk engine failed for idempotent replay:', err.message);
      }
      return res.status(200).json({ ok: true });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `
          SELECT status
          FROM mpesa_c2b_payments
          WHERE id = $1
          FOR UPDATE
        `,
        [paymentId]
      );
      const lockedStatus = locked.rows[0]?.status;
      if (lockedStatus !== 'RECEIVED') {
        await client.query('ROLLBACK');
        return res.status(200).json({ ok: true });
      }
      const result = await creditFareWithFeesByWalletId({
        walletId,
        amount: amountNumber,
        source: 'MPESA_C2B',
        sourceRef,
        description: `M-Pesa fare from ${phone_number || 'unknown'}`,
        client,
      });
      const updated = await client.query(
        `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status = 'RECEIVED'`,
        [paymentId]
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(200).json({ ok: true });
      }
      await client.query('COMMIT');

      console.log(
        `Wallet credited: walletId=${result.matatuWalletId}, before=${result.matatuBalanceBefore}, after=${result.matatuBalanceAfter}`
      );
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error crediting wallet for C2B:', err.message);
      await pool.query(`UPDATE mpesa_c2b_payments SET status = 'REJECTED' WHERE id = $1 AND status = 'RECEIVED'`, [
        paymentId,
      ]);
      return res.status(200).json({ ok: true });
    } finally {
      client.release();
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error handling M-Pesa callback:', err.message);

    return res.status(200).json({ ok: true });
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
      return res.status(200).json({ ok: true });
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

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error processing B2C Result:', err.message);

    return res.status(200).json({ ok: true });
  }
});

module.exports = router;
