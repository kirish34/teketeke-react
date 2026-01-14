const express = require('express');
const router = express.Router();

const pool = require('../db/pool');
const { creditFareWithFeesByWalletId, debitWallet } = require('../wallet/wallet.service');
const { normalizeRef, resolveWalletByRef } = require('../wallet/wallet.aliases');
const { validatePaybillCode } = require('../wallet/paybillCode.util');
const { applyRiskRules } = require('../mpesa/c2bRisk');
const { insertPayoutEvent, updateBatchStatusFromItems } = require('../services/saccoPayouts.service');
const { createOpsAlert } = require('../services/opsAlerts.service');

const C2B_ACK = { ResultCode: 0, ResultDesc: 'Accepted' };
const EXPECTED_PAYBILL = process.env.MPESA_C2B_SHORTCODE || process.env.DARAJA_SHORTCODE || null;

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

function createNoopRes() {
  const res = {};
  res.status = () => res;
  res.json = () => res;
  return res;
}

function buildCorrelationId(body = {}) {
  return (
    body.TransID ||
    body.transId ||
    (body.transaction && body.transaction.id) ||
    body.BillRefNumber ||
    body.AccountReference ||
    body.accountReference ||
    body.account_ref ||
    `c2b-${Date.now()}`
  );
}

function logWithCtx(level, message, ctx = {}, extra = {}) {
  const payload = { ...ctx, ...extra };
  const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  printer('[MPESA_C2B]', message, payload);
}

function respondC2bAck(res) {
  try {
    return res.status(200).json(C2B_ACK);
  } catch (err) {
    return null;
  }
}

function enqueueC2BProcessing(req, res, source = 'direct') {
  const payload = req.body || {};
  const headers = { ...(req.headers || {}) };
  const correlationId = buildCorrelationId(payload);

  const callbackReq = {
    body: payload,
    headers,
    correlationId,
    source,
  };

  const webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || null;
  if (webhookSecret) {
    callbackReq.headers['x-webhook-secret'] = webhookSecret;
  }

  const noopRes = createNoopRes();
  respondC2bAck(res);

  setImmediate(() => {
    handleC2BCallback(callbackReq, noopRes).catch((err) => {
      logWithCtx('error', 'Async C2B handler failed', { correlation_id: correlationId, source }, { error: err.message });
    });
  });
}

async function handlePayoutB2CResult({
  originator,
  conversationId,
  transactionId,
  resultCode,
  resultDesc,
  isTimeout = false,
}) {
  const matchKey = originator || conversationId;
  if (!matchKey) return false;

  const matchRes = await pool.query(
    `
      SELECT id
      FROM payout_items
      WHERE idempotency_key = $1
         OR provider_request_id = $1
         OR provider_conversation_id = $1
      LIMIT 1
    `,
    [matchKey],
  );
  if (!matchRes.rows.length) return false;

  const itemId = matchRes.rows[0].id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemRes = await client.query(
      `
        SELECT id, status, wallet_id, amount, batch_id, wallet_kind, failure_reason
        FROM payout_items
        WHERE id = $1
        FOR UPDATE
      `,
      [itemId],
    );
    const item = itemRes.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return true;
    }

    if (['CONFIRMED', 'CANCELLED', 'BLOCKED'].includes(item.status)) {
      await client.query('ROLLBACK');
      return true;
    }

    const providerRequestId = originator || conversationId || null;
    const providerReceipt = transactionId || null;
    const success = Number(resultCode) === 0;
    if (!success && item.status === 'FAILED') {
      await client.query('ROLLBACK');
      return true;
    }

    if (success) {
      try {
        await debitWallet({
          walletId: item.wallet_id,
          amount: item.amount,
          source: 'SACCO_PAYOUT',
          sourceRef: item.id,
          entryType: 'PAYOUT_DEBIT',
          referenceType: 'PAYOUT_ITEM',
          referenceId: item.id,
          description: `SACCO payout ${item.wallet_kind || ''}`.trim(),
          client,
        });
      } catch (err) {
        const insufficient = String(err.message || '').toUpperCase().includes('INSUFFICIENT_BALANCE');
        const failureReason = insufficient ? 'INSUFFICIENT_BALANCE_AT_CONFIRM' : err.message || 'Wallet debit failed';
        await client.query(
          `
            UPDATE payout_items
            SET status = 'FAILED',
                failure_reason = $2,
                provider_receipt = $3,
                provider_request_id = COALESCE(provider_request_id, $4),
                provider_conversation_id = COALESCE(provider_conversation_id, $5)
            WHERE id = $1
          `,
          [item.id, failureReason, providerReceipt, providerRequestId, conversationId || null],
        );
        await insertPayoutEvent({
          batchId: item.batch_id,
          itemId: item.id,
          actorId: null,
          eventType: 'ITEM_FAILED',
          message: 'Wallet debit failed',
          meta: { error: failureReason },
          client,
        });
        await createOpsAlert({
          type: 'PAYOUT_INSUFFICIENT_BALANCE',
          severity: 'CRITICAL',
          entity_type: 'WALLET',
          entity_id: String(item.wallet_id || ''),
          payment_id: null,
          message: 'Wallet debit failed on payout confirmation.',
          meta: { item_id: item.id, batch_id: item.batch_id, error: failureReason },
          client,
        });
        await updateBatchStatusFromItems({ batchId: item.batch_id, client });
        await client.query('COMMIT');
        return true;
      }

      await client.query(
        `
          UPDATE payout_items
          SET status = 'CONFIRMED',
              provider_receipt = $2,
              provider_request_id = COALESCE(provider_request_id, $3),
              provider_conversation_id = COALESCE(provider_conversation_id, $4),
              failure_reason = null
          WHERE id = $1
        `,
        [item.id, providerReceipt, providerRequestId, conversationId || null],
      );
      await insertPayoutEvent({
        batchId: item.batch_id,
        itemId: item.id,
        actorId: null,
        eventType: 'ITEM_CONFIRMED',
        message: 'Payout confirmed',
        meta: { provider_receipt: providerReceipt },
        client,
      });
    } else {
      if (isTimeout && item.status === 'FAILED' && String(item.failure_reason || '').includes('TIMEOUT')) {
        await createOpsAlert({
          type: 'PAYOUT_TIMEOUT_REPEAT',
          severity: 'WARN',
          entity_type: 'WALLET',
          entity_id: String(item.wallet_id || ''),
          payment_id: null,
          message: 'Repeated payout timeout callbacks received.',
          meta: { item_id: item.id, batch_id: item.batch_id },
          client,
        });
      }
      await client.query(
        `
          UPDATE payout_items
          SET status = 'FAILED',
              failure_reason = $2,
              provider_receipt = $3,
              provider_request_id = COALESCE(provider_request_id, $4),
              provider_conversation_id = COALESCE(provider_conversation_id, $5)
          WHERE id = $1
        `,
        [item.id, `${resultDesc} (code=${resultCode})`, providerReceipt, providerRequestId, conversationId || null],
      );
      await insertPayoutEvent({
        batchId: item.batch_id,
        itemId: item.id,
        actorId: null,
        eventType: 'ITEM_FAILED',
        message: 'Provider failed',
        meta: { result_code: resultCode, result_desc: resultDesc },
        client,
      });
      await createOpsAlert({
        type: 'PAYOUT_ITEM_FAILED',
        severity: 'WARN',
        entity_type: 'WALLET',
        entity_id: String(item.wallet_id || ''),
        payment_id: null,
        message: 'Payout failed in provider callback.',
        meta: { item_id: item.id, batch_id: item.batch_id, result_code: resultCode, result_desc: resultDesc },
        client,
      });
    }

    await updateBatchStatusFromItems({ batchId: item.batch_id, client });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error processing payout B2C result:', err.message);
  } finally {
    client.release();
  }

  return true;
}

function extractResultValue(result, key) {
  const params =
    result?.ResultParameters?.ResultParameter ||
    result?.resultParameters?.resultParameter ||
    result?.ResultParameters?.resultParameter ||
    [];
  if (!Array.isArray(params)) return null;
  const match = params.find((p) => String(p.Key || p.key || '').toLowerCase() === key.toLowerCase());
  return match ? match.Value ?? match.value ?? null : null;
}

function handleB2CResult(req, res) {
  const body = req.body || {};
  console.log('Received M-Pesa B2C Result:', JSON.stringify(body));

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });

  const webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || null;
  const got = (req.headers && req.headers['x-webhook-secret']) || '';
  const secretMismatch = webhookSecret ? got !== webhookSecret : false;
  if (secretMismatch) {
    console.warn('B2C Result webhook secret mismatch; processing without blocking');
  }

  setImmediate(async () => {
    try {
      const result = body.Result || body.result || body || {};
      const originator = result.OriginatorConversationID || result.originatorConversationID || null;
      const conversationId = result.ConversationID || result.conversationID || null;
      const transactionId =
        result.TransactionID ||
        result.transactionID ||
        extractResultValue(result, 'TransactionReceipt') ||
        null;
      const resultCode = Number(result.ResultCode ?? result.resultCode ?? -1);
      const resultDesc = result.ResultDesc ?? result.resultDesc ?? 'Unknown';

      const handledPayout = await handlePayoutB2CResult({
        originator,
        conversationId,
        transactionId,
        resultCode,
        resultDesc,
      });
      if (handledPayout) {
        return;
      }

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
          transactionId || null,
          body,
          resultDesc || null,
          conversationId,
        ],
      );
    } catch (err) {
      console.error('Error processing B2C Result:', err.message);
    }
  });
}

function handleB2CTimeout(req, res) {
  const body = req.body || {};
  console.log('Received M-Pesa B2C Timeout:', JSON.stringify(body));

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });

  const webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || null;
  const got = (req.headers && req.headers['x-webhook-secret']) || '';
  const secretMismatch = webhookSecret ? got !== webhookSecret : false;
  if (secretMismatch) {
    console.warn('B2C Timeout webhook secret mismatch; processing without blocking');
  }

  setImmediate(async () => {
    try {
      const result = body.Result || body.result || body || {};
      const originator = result.OriginatorConversationID || result.originatorConversationID || null;
      const conversationId = result.ConversationID || result.conversationID || null;
      const resultDesc = result.ResultDesc ?? result.resultDesc ?? 'Timeout';

      await handlePayoutB2CResult({
        originator,
        conversationId,
        transactionId: null,
        resultCode: -1,
        resultDesc: String(resultDesc || 'Timeout'),
        isTimeout: true,
      });
    } catch (err) {
      console.error('Error processing B2C Timeout:', err.message);
    }
  });
}

/**
 * POST /mpesa/callback
 * - Store raw payload
 * - Credit wallet using account_reference as virtual_account_code
 * - Mark raw row as processed
 */
async function handleC2BCallback(req, res) {
  const body = req.body || {};
  const correlationId = req.correlationId || buildCorrelationId(body);
  let logCtx = { correlation_id: correlationId, source: req.source || 'direct' };
  const log = (level, message, extra = {}) => logWithCtx(level, message, logCtx, extra);
  const finish = (decision, extra = {}) => {
    log('info', `Decision=${decision}`, extra);
    return respondC2bAck(res);
  };

  log('info', 'Received M-Pesa callback');

  const webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || null;
  const got = req.headers['x-webhook-secret'] || '';
  const requireSecret = process.env.MPESA_C2B_REQUIRE_SECRET === '1';
  const secretProvided = Boolean(got);
  const secretMismatch = webhookSecret
    ? (requireSecret ? got !== webhookSecret : secretProvided && got !== webhookSecret)
    : false;

  if (webhookSecret && !secretProvided && !requireSecret) {
    log('warn', 'Webhook secret header missing; continuing (not enforced)');
  }

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
  const amountNumber = Number(amount);
  const amountValue = Number.isFinite(amountNumber) ? amountNumber : 0;

  logCtx = {
    ...logCtx,
    receipt: mpesa_receipt || null,
    account_reference: normalizedRef || null,
    paybill_number,
    amount: amountValue,
  };

  if (secretMismatch) {
    log('warn', 'M-Pesa callback rejected: bad webhook secret');
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
          log('warn', 'Risk engine failed for webhook secret mismatch', { error: err.message });
        }
      }
    } catch (err) {
      log('warn', 'Failed to quarantine webhook secret mismatch', { error: err.message });
    }

    return finish('QUARANTINED', { reason: 'WEBHOOK_SECRET_MISMATCH' });
  }

  if (parseError) {
    log('error', 'Failed to parse callback', { error: parseError.message });
    return finish('PARSE_FAILED', { reason: parseError.message });
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
      log('info', 'Duplicate callback ignored', { payment_id: paymentId, status: paymentStatus });
      try {
        await applyRiskRules({ paymentId, reasonCodes: ['DUPLICATE_RECEIPT'] });
      } catch (err) {
        log('warn', 'Risk engine failed for duplicate receipt', { error: err.message });
      }
      return finish('DUPLICATE', { payment_id: paymentId, status: paymentStatus });
    }

    if (EXPECTED_PAYBILL && String(paybill_number || '') !== String(EXPECTED_PAYBILL)) {
      log('warn', 'ALERT: C2B paybill mismatch');
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
        log('warn', 'Risk engine failed for paybill mismatch', { error: err.message });
      }
      return finish('QUARANTINED', { payment_id: paymentId, reason: 'PAYBILL_MISMATCH' });
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      log('warn', 'ALERT: C2B invalid amount', { amount });
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
        log('warn', 'Risk engine failed for invalid amount', { error: err.message });
      }
      return finish('QUARANTINED', { payment_id: paymentId, reason: 'INVALID_AMOUNT' });
    }

    if (!validatePaybillCode(normalizedRef)) {
      log('warn', 'ALERT: C2B invalid checksum account reference');
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
        log('warn', 'Risk engine failed for invalid checksum reference', { error: err.message });
      }
      return finish('QUARANTINED', { payment_id: paymentId, reason: 'INVALID_CHECKSUM_REF' });
    }

    const walletId = await resolveWalletByRef(normalizedRef);
    if (!walletId) {
      log('warn', 'ALERT: C2B unknown account reference');
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
        log('warn', 'Risk engine failed for unknown account reference', { error: err.message });
      }
      return finish('QUARANTINED', { payment_id: paymentId, reason: 'UNKNOWN_ACCOUNT_REF' });
    }

    let riskResult = null;
    try {
      riskResult = await applyRiskRules({ paymentId, reasonCodes: [] });
    } catch (err) {
      log('warn', 'Risk engine failed for C2B payment', { error: err.message });
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
      return finish('QUARANTINED', { payment_id: paymentId, reason: 'HIGH_RISK' });
    }

    const sourceRef = mpesa_receipt || String(paymentId);
    const existingTx = await pool.query(
      `
        SELECT id
        FROM wallet_ledger
        WHERE reference_type = 'MPESA_C2B' AND reference_id = $1
        LIMIT 1
      `,
      [String(paymentId)]
    );
    if (existingTx.rows.length) {
      await pool.query(
        `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status = 'RECEIVED'`,
        [paymentId]
      );
      try {
        await applyRiskRules({ paymentId, reasonCodes: ['IDEMPOTENT_REPLAY'] });
      } catch (err) {
        log('warn', 'Risk engine failed for idempotent replay', { error: err.message });
      }
      return finish('ALREADY_CREDITED', { payment_id: paymentId });
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
        return finish('LOCKED_SKIP', { payment_id: paymentId, status: lockedStatus });
      }
      const result = await creditFareWithFeesByWalletId({
        walletId,
        amount: amountNumber,
        source: 'MPESA_C2B',
        sourceRef,
        referenceId: paymentId,
        referenceType: 'MPESA_C2B',
        description: `M-Pesa fare from ${phone_number || 'unknown'}`,
        client,
      });
      const updated = await client.query(
        `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status = 'RECEIVED'`,
        [paymentId]
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return finish('LOCKED_SKIP', { payment_id: paymentId, status: lockedStatus || 'UNKNOWN' });
      }
      await client.query('COMMIT');

      log('info', 'Wallet credited', {
        wallet_id: result.matatuWalletId,
        balance_before: result.matatuBalanceBefore,
        balance_after: result.matatuBalanceAfter,
        payment_id: paymentId,
      });
      return finish('CREDITED', { payment_id: paymentId, wallet_id: result.matatuWalletId });
    } catch (err) {
      await client.query('ROLLBACK');
      log('error', 'Error crediting wallet for C2B', { error: err.message });
      await pool.query(`UPDATE mpesa_c2b_payments SET status = 'REJECTED' WHERE id = $1 AND status = 'RECEIVED'`, [
        paymentId,
      ]);
      return finish('REJECTED', { payment_id: paymentId, reason: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    log('error', 'Error handling M-Pesa callback', { error: err.message });
    return finish('ERROR', { reason: err.message });
  }
}

const handleC2BValidation = (req, res) => {
  console.log('Received M-Pesa C2B validation:', JSON.stringify(req.body || {}));
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

const handleC2BConfirmation = (req, res) => enqueueC2BProcessing(req, res, 'c2b_confirmation');

router.post('/c2b/validation', handleC2BValidation);
router.post('/c2b/confirmation', handleC2BConfirmation);

router.post('/callback', (req, res) => enqueueC2BProcessing(req, res, 'direct_callback'));

/**
 * POST /mpesa/b2c-result
 * Updates withdrawals based on Daraja B2C result callback.
 */
router.post('/b2c-result', handleB2CResult);
router.post('/b2c/callback', handleB2CResult);
router.post('/b2c/result', handleB2CResult);
router.post('/b2c/timeout', handleB2CTimeout);

module.exports = router;
module.exports.handleC2BValidation = handleC2BValidation;
module.exports.handleC2BConfirmation = handleC2BConfirmation;
