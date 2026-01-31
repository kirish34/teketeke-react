const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const pool = require('../db/pool');
const { creditFareWithFeesByWalletId, debitWallet } = require('../wallet/wallet.service');
const { creditWalletWithLedger } = require('../services/walletLedger.service');
const { resolveActiveTripIdForMatatu, getInProgressTripForMatatu, startTripForMatatu } = require('../services/trip.service');
const { resolveActiveShiftIdForMatatu, getOpenShiftForMatatu, openShiftForMatatu } = require('../services/shift.service');
const { normalizeRef, resolveWalletByRef } = require('../wallet/wallet.aliases');
const { validatePaybillCode } = require('../wallet/paybillCode.util');
const { applyRiskRules } = require('../mpesa/c2bRisk');
const { insertPayoutEvent, updateBatchStatusFromItems } = require('../services/saccoPayouts.service');
const { createOpsAlert } = require('../services/opsAlerts.service');
const { normalizeMsisdn, maskMsisdn } = require('../utils/msisdn');
const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const {
  ensureIdempotent,
  validateRequired,
  verifyShortcode,
  safeAck,
  logCallbackAudit,
} = require('../services/callbackHardening.service');

const C2B_ACK = { ResultCode: 0, ResultDesc: 'Accepted' };
const EXPECTED_PAYBILL = process.env.MPESA_C2B_SHORTCODE || process.env.DARAJA_SHORTCODE || null;

const DARAJA_ENV = process.env.DARAJA_ENV || 'sandbox';
const DARAJA_SHORTCODE = process.env.DARAJA_SHORTCODE || null;
const DARAJA_PASSKEY = process.env.DARAJA_PASSKEY || null;
const DARAJA_CALLBACK_URL = process.env.DARAJA_CALLBACK_URL || null;
const DARAJA_CONSUMER_KEY = process.env.DARAJA_CONSUMER_KEY || null;
const DARAJA_CONSUMER_SECRET = process.env.DARAJA_CONSUMER_SECRET || null;

function darajaHost() {
  return DARAJA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

function base64(str) {
  return Buffer.from(str).toString('base64');
}

async function getDarajaToken() {
  const key = DARAJA_CONSUMER_KEY;
  const secret = DARAJA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('Daraja credentials missing');
  const res = await fetch(`${darajaHost()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${base64(`${key}:${secret}`)}` },
  });
  if (!res.ok) throw new Error(`Daraja token error: ${res.statusText}`);
  const j = await res.json();
  return j.access_token;
}

async function resolveWalletTarget({
  walletCode,
  aliasRef,
  matatuId,
  saccoId,
  walletKind,
}) {
  if (walletCode) {
    const res = await pool.query(
      `SELECT id, wallet_code FROM wallets WHERE wallet_code = $1 LIMIT 1`,
      [walletCode],
    );
    if (res.rows.length) return { walletId: res.rows[0].id, walletCode: res.rows[0].wallet_code };
  }

  if (aliasRef) {
    const walletId = await resolveWalletByRef(aliasRef);
    if (walletId) {
      const res = await pool.query(`SELECT wallet_code FROM wallets WHERE id = $1 LIMIT 1`, [walletId]);
      return { walletId, walletCode: res.rows[0]?.wallet_code || aliasRef };
    }
  }

  if (matatuId || saccoId) {
    const where = [];
    const params = [];
    if (matatuId) {
      params.push(matatuId);
      where.push(`matatu_id = $${params.length}`);
    }
    if (saccoId) {
      params.push(saccoId);
      where.push(`sacco_id = $${params.length}`);
    }
    if (walletKind) {
      params.push(walletKind);
      where.push(`wallet_kind = $${params.length}`);
    }
    params.push(1);
    const res = await pool.query(
      `
        SELECT id, wallet_code
        FROM wallets
        WHERE ${where.join(' AND ')}
        LIMIT $${params.length}
      `,
      params,
    );
    if (res.rows.length) return { walletId: res.rows[0].id, walletCode: res.rows[0].wallet_code };
  }

  return { walletId: null, walletCode: walletCode || aliasRef || null };
}

function buildAccountReference({ accountReference, aliasRef, walletCode }) {
  const ref = accountReference || aliasRef || walletCode || null;
  return ref ? normalizeRef(ref) : null;
}

// --- STK Push: initiate ---
router.post('/stk/initiate', async (req, res) => {
  const {
    phone,
    amount,
    wallet_code: walletCodeRaw,
    alias,
    matatu_id: matatuId,
    sacco_id: saccoId,
    wallet_kind: walletKindRaw,
    account_reference: accountRefInput,
  } = req.body || {};

  const walletKind = walletKindRaw ? String(walletKindRaw).toUpperCase() : null;
  const aliasRef = alias ? normalizeRef(alias) : null;

  const amt = Number(amount || 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ ok: false, error: 'amount must be > 0' });
  }

  const normalizedMsisdn = normalizeMsisdn(phone);
  if (!normalizedMsisdn) {
    return res.status(400).json({ ok: false, error: 'invalid phone' });
  }

  const { walletId, walletCode } = await resolveWalletTarget({
    walletCode: walletCodeRaw,
    aliasRef,
    matatuId,
    saccoId,
    walletKind,
  });

  if (!walletId) {
    return res.status(404).json({ ok: false, error: 'wallet not found' });
  }

  const accountRef = buildAccountReference({ accountReference: accountRefInput, aliasRef, walletCode });

  if (!DARAJA_SHORTCODE || !DARAJA_PASSKEY || !DARAJA_CALLBACK_URL) {
    return res.status(500).json({ ok: false, error: 'Daraja STK config missing' });
  }

  try {
    const token = await getDarajaToken();
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const password = base64(DARAJA_SHORTCODE + DARAJA_PASSKEY + timestamp);
    const payload = {
      BusinessShortCode: DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amt,
      PartyA: normalizedMsisdn,
      PartyB: DARAJA_SHORTCODE,
      PhoneNumber: normalizedMsisdn,
      CallBackURL: DARAJA_CALLBACK_URL,
      AccountReference: accountRef,
      TransactionDesc: 'TekeTeke STK',
    };

    const r = await fetch(`${darajaHost()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ ok: false, error: j.errorMessage || 'Daraja error', raw: j });

    const checkoutRequestId = j.CheckoutRequestID || null;
    const merchantRequestId = j.MerchantRequestID || null;

    await pool.query(
      `
        insert into mpesa_stk_requests
          (wallet_id, wallet_code, account_reference, amount, msisdn, msisdn_normalized, display_msisdn, msisdn_source,
           checkout_request_id, merchant_request_id, status, raw_request)
        values
          ($1, $2, $3, $4, $5, $6, $7, 'mpesa', $8, $9, 'REQUESTED', $10)
        on conflict (checkout_request_id) do update
          set raw_request = excluded.raw_request
      `,
      [
        walletId,
        walletCode,
        accountRef,
        amt,
        phone || normalizedMsisdn,
        normalizedMsisdn,
        maskMsisdn(normalizedMsisdn),
        checkoutRequestId,
        merchantRequestId,
        { request: payload, response: j },
      ],
    );

    return res.json({
      ok: true,
      checkoutRequestId,
      merchantRequestId,
      status: j.ResponseDescription || 'REQUESTED',
    });
  } catch (err) {
    console.error('STK initiate error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// --- STK Push: callback ---
router.post('/stk/callback', async (req, res) => {
  const cb = req.body?.Body?.stkCallback;
  if (!cb) {
    await logCallbackAudit({ req, key: null, kind: 'STK_CALLBACK', result: 'ignored', reason: 'missing_callback' });
    return safeAck(res, { ok: true, ignored: true });
  }

  const checkoutRequestId = cb?.CheckoutRequestID || null;
  const resultCode = Number(cb?.ResultCode || 0);
  const resultDesc = cb?.ResultDesc || null;
  const items = Array.isArray(cb?.CallbackMetadata?.Item) ? cb.CallbackMetadata.Item : [];
  const getItem = (name) => items.find((i) => i?.Name === name)?.Value;
  const receipt = getItem('MpesaReceiptNumber') || null;
  const amount = Number(getItem('Amount') || 0);
  const msisdnRaw = String(getItem('PhoneNumber') || '');
  const normalizedMsisdn = normalizeMsisdn(msisdnRaw);
  const providerRef = receipt || checkoutRequestId || null;

  const validation = validateRequired({ checkoutRequestId }, ['checkoutRequestId']);
  if (!validation.ok) {
    await logCallbackAudit({
      req,
      key: checkoutRequestId || null,
      kind: 'STK_CALLBACK',
      result: 'ignored',
      reason: 'invalid_payload',
      payload: { missing: validation.missing },
    });
    return safeAck(res, { ok: true, ignored: true, reason: 'invalid_payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stkRes = await client.query(
      `
        select *
        from mpesa_stk_requests
        where checkout_request_id = $1
        for update
      `,
      [checkoutRequestId],
    );
    let stkRow = stkRes.rows[0] || null;

    if (!stkRow) {
      const insertRes = await client.query(
        `
          insert into mpesa_stk_requests (checkout_request_id, status, raw_callback, amount, msisdn, msisdn_normalized, provider_receipt, error)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          returning *
        `,
        [
          checkoutRequestId,
          resultCode === 0 ? 'RECEIVED' : 'FAILED',
          cb,
          amount || 0,
          msisdnRaw || null,
          normalizedMsisdn || null,
          receipt || null,
          resultCode === 0 ? null : resultDesc || 'STK failed',
        ],
      );
      stkRow = insertRes.rows[0];
    } else {
      await client.query(
        `
          update mpesa_stk_requests
          set raw_callback = $2,
              provider_receipt = $3,
              msisdn = coalesce(msisdn, $4),
              msisdn_normalized = coalesce(msisdn_normalized, $5),
              amount = coalesce(amount, $6),
              status = $7,
              error = $8
          where checkout_request_id = $1
        `,
        [
          checkoutRequestId,
          cb,
          receipt || stkRow.provider_receipt || null,
          msisdnRaw || null,
          normalizedMsisdn || null,
          amount || stkRow.amount || 0,
          resultCode === 0 ? 'RECEIVED' : 'FAILED',
          resultCode === 0 ? null : resultDesc || 'STK failed',
        ],
      );
    }

    if (stkRow.status === 'SUCCESS') {
      await client.query('COMMIT');
      return safeAck(res, { ok: true, duplicate: true });
    }

    if (resultCode !== 0) {
      await client.query('COMMIT');
      return safeAck(res, { ok: true, failed: true });
    }

    const walletId = stkRow.wallet_id || (stkRow.account_reference ? await resolveWalletByRef(stkRow.account_reference) : null);
    if (!walletId) {
      await client.query(
        `
          update mpesa_stk_requests
          set status = 'QUARANTINED', error = 'wallet_not_found'
          where checkout_request_id = $1
        `,
        [checkoutRequestId],
      );
      await client.query('COMMIT');
      return safeAck(res, { ok: true, quarantined: true });
    }

    const walletMeta = await client.query(`SELECT matatu_id FROM wallets WHERE id = $1 LIMIT 1`, [walletId]);
    const matatuIdForTrip = walletMeta.rows[0]?.matatu_id || null;

    let shiftRow = matatuIdForTrip ? await getOpenShiftForMatatu(matatuIdForTrip) : null;
    if (!shiftRow && matatuIdForTrip) {
      shiftRow = await openShiftForMatatu(matatuIdForTrip, null, 'SYSTEM', true);
    }
    let tripRow = matatuIdForTrip ? await getInProgressTripForMatatu(matatuIdForTrip) : null;
    if (!tripRow && matatuIdForTrip) {
      tripRow = await startTripForMatatu(matatuIdForTrip, shiftRow?.id || null, null, 'SYSTEM', true);
    }

    const tripId = tripRow?.id || null;
    const shiftId = shiftRow?.id || null;

    const ledgerResult = await creditWalletWithLedger({
      walletId,
      amount: amount || stkRow.amount || 0,
      entryType: 'STK_CREDIT',
      referenceType: 'STK_CHECKOUT',
      referenceId: checkoutRequestId,
      description: `STK payment from ${normalizedMsisdn || msisdnRaw || 'unknown'}`,
      provider: 'MPESA',
      providerRef,
      source: 'MPESA_STK',
      sourceRef: checkoutRequestId,
      tripId: tripId || null,
      shiftId: shiftId || null,
      client,
    });

    await client.query(
      `
        update mpesa_stk_requests
        set status = 'SUCCESS',
            credited_ledger_id = coalesce($2, credited_ledger_id),
            provider_receipt = coalesce($3, provider_receipt),
            wallet_id = $4,
            wallet_code = coalesce(wallet_code, $5),
            account_reference = coalesce(account_reference, $6),
            trip_id = coalesce(trip_id, $7),
            shift_id = coalesce(shift_id, $8)
        where checkout_request_id = $1
      `,
      [
        checkoutRequestId,
        ledgerResult.ledgerId || null,
        receipt || null,
        walletId,
        stkRow.wallet_code || null,
        stkRow.account_reference || null,
        tripId || null,
        shiftId || null,
      ],
    );

    await logCallbackAudit({
      req,
      key: providerRef || checkoutRequestId,
      kind: 'STK_CALLBACK',
      result: ledgerResult?.deduped ? 'accepted_deduped' : 'accepted',
    });

    await client.query('COMMIT');
    return safeAck(res, { ok: true, credited: Boolean(ledgerResult.ledgerId), deduped: Boolean(ledgerResult.deduped) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('STK callback error:', err.message);
    return safeAck(res, { ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// --- STK reconciliation/admin report ---
router.get('/stk/recon', requireSystemOrSuper, async (_req, res) => {
  try {
    const missingLedger = await pool.query(
      `
        select checkout_request_id, wallet_id, amount, status
        from mpesa_stk_requests
        where status = 'SUCCESS' and credited_ledger_id is null
        limit 100
      `,
    );
    const ledgerNoProviderRef = await pool.query(
      `
        select id, wallet_id, reference_id, provider_ref
        from wallet_ledger
        where reference_type = 'STK_CHECKOUT' and (provider_ref is null or provider_ref = '')
        order by created_at desc
        limit 100
      `,
    );
    return res.json({
      ok: true,
      missingLedger: missingLedger.rows || [],
      ledgerMissingProviderRef: ledgerNoProviderRef.rows || [],
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

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

async function upsertC2bPaymentQuarantine({
  paybill_number,
  account_reference,
  amountValue,
  msisdn,
  msisdn_normalized,
  display_msisdn,
  msisdn_source,
  mpesa_receipt,
  body,
}) {
  if (!mpesa_receipt) return { id: null, status: null };

  const existing = await pool.query(
    `SELECT id, status FROM mpesa_c2b_payments WHERE receipt = $1 LIMIT 1`,
    [mpesa_receipt]
  );

  if (existing.rows.length) {
    const currentStatus = existing.rows[0].status;
    const nextStatus = ['CREDITED', 'REJECTED', 'QUARANTINED'].includes(currentStatus) ? currentStatus : 'QUARANTINED';
    const res = await pool.query(
      `
        UPDATE mpesa_c2b_payments
        SET paybill_number = $1,
            account_reference = $2,
            amount = $3,
            msisdn = $4,
            msisdn_normalized = $5,
            display_msisdn = $6,
            msisdn_source = $7,
            raw = $8,
            status = $9
        WHERE receipt = $10
        RETURNING id, status
      `,
      [
        paybill_number || null,
        account_reference || null,
        amountValue,
        msisdn,
        msisdn_normalized || null,
        display_msisdn || null,
        msisdn_source || null,
        body,
        nextStatus,
        mpesa_receipt,
      ]
    );
    return res.rows[0] || { id: null, status: null };
  }

  const insertRes = await pool.query(
    `
      INSERT INTO mpesa_c2b_payments
        (paybill_number, account_reference, amount, msisdn, msisdn_normalized, display_msisdn, msisdn_source, receipt, status, raw)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, 'QUARANTINED', $9)
      RETURNING id, status
    `,
    [
      paybill_number || null,
      account_reference || null,
      amountValue,
      msisdn,
      msisdn_normalized || null,
      display_msisdn || null,
      msisdn_source || null,
      mpesa_receipt,
      body,
    ]
  );
  return insertRes.rows[0] || { id: null, status: null };
}

async function upsertC2bPaymentReceived({
  paybill_number,
  account_reference,
  amountValue,
  msisdn,
  msisdn_normalized,
  display_msisdn,
  msisdn_source,
  mpesa_receipt,
  body,
}) {
  if (!mpesa_receipt) return { id: null, status: null };

  const existing = await pool.query(
    `SELECT id, status FROM mpesa_c2b_payments WHERE receipt = $1 LIMIT 1`,
    [mpesa_receipt]
  );

  if (existing.rows.length) {
    const res = await pool.query(
      `
        UPDATE mpesa_c2b_payments
        SET paybill_number = $1,
            account_reference = $2,
            amount = $3,
            msisdn = $4,
            msisdn_normalized = $5,
            display_msisdn = $6,
            msisdn_source = $7,
            raw = $8
        WHERE receipt = $9
        RETURNING id, status
      `,
      [
        paybill_number || null,
        account_reference || null,
        amountValue,
        msisdn,
        msisdn_normalized || null,
        display_msisdn || null,
        msisdn_source || null,
        body,
        mpesa_receipt,
      ]
    );
    return res.rows[0] || { id: null, status: null };
  }

  const insertRes = await pool.query(
    `
      INSERT INTO mpesa_c2b_payments
        (paybill_number, account_reference, amount, msisdn, msisdn_normalized, display_msisdn, msisdn_source, receipt, status, raw)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, 'RECEIVED', $9)
      RETURNING id, status
    `,
    [
      paybill_number || null,
      account_reference || null,
      amountValue,
      msisdn,
      msisdn_normalized || null,
      display_msisdn || null,
      msisdn_source || null,
      mpesa_receipt,
      body,
    ]
  );
  return insertRes.rows[0] || { id: null, status: null };
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
  let itemId = null;
  if (originator) {
    const byOrigin = await pool.query(
      `SELECT id FROM payout_items WHERE provider_request_id = $1 LIMIT 1`,
      [originator],
    );
    if (byOrigin.rows.length) itemId = byOrigin.rows[0].id;
  }
  if (!itemId && conversationId) {
    const byConv = await pool.query(
      `SELECT id FROM payout_items WHERE provider_conversation_id = $1 LIMIT 1`,
      [conversationId],
    );
    if (byConv.rows.length) itemId = byConv.rows[0].id;
  }
  if (!itemId && originator) {
    const byIdem = await pool.query(
      `SELECT id FROM payout_items WHERE idempotency_key = $1 LIMIT 1`,
      [originator],
    );
    if (byIdem.rows.length) itemId = byIdem.rows[0].id;
  }
  if (!itemId) return false;

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
    const providerRef = providerReceipt || providerRequestId || null;
    const success = Number(resultCode) === 0;
    if (!success && item.status === 'FAILED') {
      await client.query('ROLLBACK');
      return true;
    }

    if (success) {
      let debitResult = null;
      try {
        debitResult = await debitWallet({
          walletId: item.wallet_id,
          amount: item.amount,
          source: 'SACCO_PAYOUT',
          sourceRef: item.id,
          entryType: 'PAYOUT_DEBIT',
          referenceType: 'PAYOUT_ITEM',
          referenceId: item.id,
          description: `SACCO payout ${item.wallet_kind || ''}`.trim(),
          provider: 'MPESA',
          providerRef,
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
        await client.query(
          `update wallet_holds set status = 'released', released_at = now()
           where reference_type = 'PAYOUT_ITEM' and reference_id = $1 and status = 'active'`,
          [item.id],
        );
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
      await client.query(
        `update wallet_holds set status = 'settled', released_at = now()
         where reference_type = 'PAYOUT_ITEM' and reference_id = $1 and status = 'active'`,
        [item.id],
      );
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
      await client.query(
        `update wallet_holds set status = 'released', released_at = now()
         where reference_type = 'PAYOUT_ITEM' and reference_id = $1 and status = 'active'`,
        [item.id],
      );
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

async function handleB2CResult(req, res) {
  const body = req.body || {};
  console.log('Received M-Pesa B2C Result:', JSON.stringify(body));

  const result = body.Result || body.result || body || {};
  const originator = result.OriginatorConversationID || result.originatorConversationID || null;
  const conversationId = result.ConversationID || result.conversationID || null;
  const transactionId =
    result.TransactionID ||
    result.transactionID ||
    extractResultValue(result, 'TransactionReceipt') ||
    null;

  const idemKey = transactionId || conversationId || originator || null;
  if (idemKey) {
    const idem = await ensureIdempotent({
      kind: 'B2C_RESULT',
      key: idemKey,
      payload: { originator, conversationId, transactionId },
    });
    if (!idem.firstTime) {
      await logCallbackAudit({
        req,
        key: idemKey,
        kind: 'B2C_RESULT',
        result: 'ignored',
        reason: 'duplicate',
      });
      return safeAck(res, { ResultCode: 0, ResultDesc: 'Received', duplicate_ignored: true });
    }
  }

  const validation = validateRequired({ conversationId: conversationId || originator }, ['conversationId']);
  if (!validation.ok) {
    logCallbackAudit({
      req,
      key: idemKey,
      kind: 'B2C_RESULT',
      result: 'ignored',
      reason: 'invalid_payload',
    });
  }

  safeAck(res, { ResultCode: 0, ResultDesc: 'Received' });

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

      await logCallbackAudit({
        req,
        key: transactionId || conversationId || originator || null,
        kind: 'B2C_RESULT',
        result: 'accepted',
      });
    } catch (err) {
      console.error('Error processing B2C Result:', err.message);
      logCallbackAudit({
        req,
        key: conversationId || null,
        kind: 'B2C_RESULT',
        result: 'rejected',
        reason: 'server_error',
        payload: { error: err.message },
      });
    }
  });
}

async function handleB2CTimeout(req, res) {
  const body = req.body || {};
  console.log('Received M-Pesa B2C Timeout:', JSON.stringify(body));

  const result = body.Result || body.result || body || {};
  const originator = result.OriginatorConversationID || result.originatorConversationID || null;
  const conversationId = result.ConversationID || result.conversationID || null;
  const resultDesc = result.ResultDesc ?? result.resultDesc ?? 'Timeout';
  const idemKey = conversationId || originator || null;

  if (idemKey) {
    const idem = await ensureIdempotent({
      kind: 'B2C_TIMEOUT',
      key: idemKey,
      payload: { originator, conversationId, resultDesc },
    });
    if (!idem.firstTime) {
      await logCallbackAudit({
        req,
        key: idemKey,
        kind: 'B2C_TIMEOUT',
        result: 'ignored',
        reason: 'duplicate',
      });
      return safeAck(res, { ResultCode: 0, ResultDesc: 'Received', duplicate_ignored: true });
    }
  }

  safeAck(res, { ResultCode: 0, ResultDesc: 'Received' });

  const webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || null;
  const got = (req.headers && req.headers['x-webhook-secret']) || '';
  const secretMismatch = webhookSecret ? got !== webhookSecret : false;
  if (secretMismatch) {
    console.warn('B2C Timeout webhook secret mismatch; processing without blocking');
  }

  setImmediate(async () => {
    try {
      await handlePayoutB2CResult({
        originator,
        conversationId,
        transactionId: null,
        resultCode: -1,
        resultDesc: String(resultDesc || 'Timeout'),
        isTimeout: true,
      });
      await logCallbackAudit({
        req,
        key: conversationId || originator || null,
        kind: 'B2C_TIMEOUT',
        result: 'accepted',
      });
    } catch (err) {
      console.error('Error processing B2C Timeout:', err.message);
      logCallbackAudit({
        req,
        key: conversationId || originator || null,
        kind: 'B2C_TIMEOUT',
        result: 'rejected',
        reason: 'server_error',
        payload: { error: err.message },
      });
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
  let idempotencyKey = null;
  const finish = async (decision, extra = {}) => {
    log('info', `Decision=${decision}`, extra);
    await logCallbackAudit({
      req,
      key: idempotencyKey || correlationId || null,
      kind: 'C2B_CALLBACK',
      result: ['DUPLICATE', 'ALREADY_CREDITED', 'PARSE_FAILED', 'QUARANTINED'].includes(decision)
        ? 'ignored'
        : 'accepted',
      reason: extra?.reason || null,
      payload: { decision, ...extra },
    });
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
  const msisdn_raw = phone_number || null;
  const msisdn_normalized = normalizeMsisdn(msisdn_raw);
  const display_msisdn = maskMsisdn(msisdn_normalized);
  const msisdn = msisdn_normalized || msisdn_raw || 'unknown';
  const msisdn_source = msisdn_raw ? 'mpesa' : 'missing';
  const normalizedRef = normalizeRef(account_reference);
  const amountNumber = Number(amount);
  const amountValue = Number.isFinite(amountNumber) ? amountNumber : 0;
  idempotencyKey = mpesa_receipt || body?.TransID || body?.transaction?.id || correlationId;

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
        const existing = await pool.query(
          `SELECT id, status FROM mpesa_c2b_payments WHERE receipt = $1 LIMIT 1`,
          [mpesa_receipt]
        );
        paymentId = existing.rows[0]?.id || null;
        paymentStatus = existing.rows[0]?.status || null;
        if (paymentStatus === 'CREDITED') {
          return finish('ALREADY_CREDITED', { payment_id: paymentId, status: paymentStatus });
        }
      }

      if (mpesa_receipt) {
        const upsertRes = await upsertC2bPaymentQuarantine({
          paybill_number,
          account_reference: normalizedRef,
          amountValue,
          msisdn,
          msisdn_source,
          msisdn_normalized,
          display_msisdn,
          mpesa_receipt,
          body,
        });
        paymentId = upsertRes?.id || paymentId;
        paymentStatus = upsertRes?.status || paymentStatus;
      } else {
        const insertRes = await pool.query(
          `
            INSERT INTO mpesa_c2b_payments
              (paybill_number, account_reference, amount, msisdn, msisdn_normalized, display_msisdn, msisdn_source, receipt, status, raw)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, 'QUARANTINED', $9)
            RETURNING id, status
          `,
          [
            paybill_number || null,
            normalizedRef || null,
            amountValue,
            msisdn,
            msisdn_normalized || null,
            display_msisdn || null,
            msisdn_source || null,
            mpesa_receipt || null,
            body,
          ]
        );
        paymentId = insertRes.rows[0]?.id || paymentId;
        paymentStatus = insertRes.rows[0]?.status || paymentStatus;
      }

      if (paymentStatus === 'QUARANTINED' || paymentStatus === 'RECEIVED') {
        await pool.query(
          `
            INSERT INTO mpesa_c2b_quarantine
              (paybill_number, account_reference, amount, msisdn, raw, reason)
            VALUES
              ($1, $2, $3, $4, $5, 'WEBHOOK_SECRET_MISMATCH')
          `,
          [paybill_number || null, normalizedRef || null, amountValue, msisdn, body]
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

  const validation = validateRequired({ account_reference: normalizedRef }, ['account_reference']);
  if (!validation.ok) {
    log('warn', 'Invalid payload (missing account_reference)', { missing: validation.missing });
    return finish('PARSE_FAILED', { reason: 'invalid_payload', missing: validation.missing });
  }

  if (idempotencyKey) {
    const idem = await ensureIdempotent({
      kind: 'C2B_CALLBACK',
      key: idempotencyKey,
      payload: { receipt: mpesa_receipt, amount: amountValue, account_reference: normalizedRef },
    });
    if (!idem.firstTime) {
      return finish('DUPLICATE', { idempotency_key: idempotencyKey });
    }
  }

  try {
    let paymentId = null;
    let paymentStatus = null;

    if (mpesa_receipt) {
      const existing = await pool.query(
        `SELECT id, status FROM mpesa_c2b_payments WHERE receipt = $1 LIMIT 1`,
        [mpesa_receipt]
      );
      paymentId = existing.rows[0]?.id || null;
      paymentStatus = existing.rows[0]?.status || null;
      if (paymentStatus === 'CREDITED') {
        return finish('ALREADY_CREDITED', { payment_id: paymentId, status: paymentStatus });
      }

      const upsertRes = await upsertC2bPaymentReceived({
        paybill_number,
        account_reference: normalizedRef,
        amountValue,
        msisdn,
        msisdn_source,
        msisdn_normalized,
        display_msisdn,
        mpesa_receipt,
        body,
      });
      paymentId = upsertRes?.id || paymentId;
      paymentStatus = upsertRes?.status || paymentStatus;
    } else {
      const insertRes = await pool.query(
        `
          INSERT INTO mpesa_c2b_payments
            (paybill_number, account_reference, amount, msisdn, msisdn_normalized, display_msisdn, msisdn_source, receipt, status, raw)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, 'RECEIVED', $9)
          RETURNING id, status
        `,
          [
            paybill_number || null,
            normalizedRef || null,
            amountValue,
            msisdn,
            msisdn_normalized || null,
            display_msisdn || null,
            msisdn_source || null,
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
    const walletMetaRes = await pool.query(`SELECT matatu_id FROM wallets WHERE id = $1 LIMIT 1`, [walletId]);
    const matatuIdForTrip = walletMetaRes.rows[0]?.matatu_id || null;

    let shiftRow = matatuIdForTrip ? await getOpenShiftForMatatu(matatuIdForTrip) : null;
    if (!shiftRow && matatuIdForTrip) {
      shiftRow = await openShiftForMatatu(matatuIdForTrip, null, 'SYSTEM', true);
    }
    let tripRow = matatuIdForTrip ? await getInProgressTripForMatatu(matatuIdForTrip) : null;
    if (!tripRow && matatuIdForTrip) {
      tripRow = await startTripForMatatu(matatuIdForTrip, shiftRow?.id || null, null, 'SYSTEM', true);
    }

    const tripId = tripRow?.id || null;
    const shiftId = shiftRow?.id || null;

    if (paymentId) {
      await pool.query(
        `
          UPDATE mpesa_c2b_payments
          SET matatu_id = COALESCE(matatu_id, $2),
              shift_id = COALESCE(shift_id, $3),
              trip_id = COALESCE(trip_id, $4),
              auto_assigned = auto_assigned OR true,
              assigned_at = COALESCE(assigned_at, now())
          WHERE id = $1
        `,
        [paymentId, matatuIdForTrip, shiftId, tripId],
      );
    }

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
        `
          UPDATE mpesa_c2b_payments
          SET status = 'CREDITED',
              matatu_id = COALESCE(matatu_id, $2),
              trip_id = COALESCE(trip_id, $3),
              shift_id = COALESCE(shift_id, $4),
              auto_assigned = auto_assigned OR true,
              assigned_at = COALESCE(assigned_at, now())
          WHERE id = $1 AND status = 'RECEIVED'
        `,
        [paymentId, matatuIdForTrip, tripId || null, shiftId || null]
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
        provider: 'mpesa',
        providerRef: mpesa_receipt || body?.TransID || sourceRef || null,
        client,
        tripId,
        shiftId,
      });
      const updated = await client.query(
        `
          UPDATE mpesa_c2b_payments
          SET status = 'CREDITED',
              matatu_id = COALESCE(matatu_id, $2),
              trip_id = COALESCE(trip_id, $3),
              shift_id = COALESCE(shift_id, $4),
              auto_assigned = auto_assigned OR true,
              assigned_at = COALESCE(assigned_at, now())
          WHERE id = $1 AND status = 'RECEIVED'
        `,
        [paymentId, matatuIdForTrip, result.tripId || tripId || null, result.shiftId || shiftId || null]
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
  const body = req.body || {};
  const account_reference =
    body.BillRefNumber || body.billRefNumber || body.AccountReference || body.account_reference || null;
  const validation = validateRequired({ account_reference }, ['account_reference']);
  if (!validation.ok) {
    logCallbackAudit({
      req,
      key: body.TransID || body.transId || null,
      kind: 'C2B_VALIDATION',
      result: 'ignored',
      reason: 'invalid_payload',
    });
  } else {
    logCallbackAudit({
      req,
      key: body.TransID || body.transId || null,
      kind: 'C2B_VALIDATION',
      result: 'accepted',
    });
  }
  return safeAck(res, { ResultCode: 0, ResultDesc: 'Accepted' });
};

const handleC2BConfirmation = (req, res) => {
  const key = req.body?.TransID || req.body?.transId || null;
  if (key) {
    ensureIdempotent({ kind: 'C2B_CONFIRMATION', key, payload: req.body || {} }).catch(() => {});
  }
  return enqueueC2BProcessing(req, res, 'c2b_confirmation');
};

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
