const express = require('express');
const fetch = require('node-fetch');
const { supabaseAdmin } = require('../supabase');
const pool = require('../db/pool');
const { creditFareWithFeesByWalletId } = require('../wallet/wallet.service');
const { normalizeRef, isPlateRef, resolveWalletByRef } = require('../wallet/wallet.aliases');
const { applyRiskRules } = require('../mpesa/c2bRisk');
const { normalizeMsisdn, maskMsisdn, extractMsisdnFromRaw } = require('../utils/msisdn');
const { ensureIdempotent, validateRequired, safeAck, logCallbackAudit } = require('../services/callbackHardening.service');
const router = express.Router();
const WEBHOOK_SECRET = process.env.DARAJA_WEBHOOK_SECRET || null;

function base64(str){ return Buffer.from(str).toString('base64'); }

async function getAccessToken(){
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  const env = process.env.DARAJA_ENV || 'sandbox';
  const host = env==='production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  const res = await fetch(host + '/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: 'Basic ' + base64(key + ':' + secret) }
  });
  if(!res.ok) throw new Error('Daraja token error: '+res.statusText);
  const j = await res.json();
  return j.access_token;
}

// Simple status check for frontend
router.get('/status', (_req, res) => {
  const env = process.env.DARAJA_ENV || 'sandbox';
  const hasKey = Boolean(process.env.DARAJA_CONSUMER_KEY);
  const hasSecret = Boolean(process.env.DARAJA_CONSUMER_SECRET);
  const shortcode = process.env.DARAJA_SHORTCODE || '';
  const hasPasskey = Boolean(process.env.DARAJA_PASSKEY);
  const callback = process.env.DARAJA_CALLBACK_URL || 'https://api.teketeke.org/api/pay/stk/callback';
  const ready = hasKey && hasSecret && shortcode && hasPasskey;
  res.json({ ok: true, env, shortcode, hasKey, hasSecret, hasPasskey, callback, ready });
});

router.post('/stk', async (req,res)=>{
  const { phone, amount, code, plate } = req.body||{};
  const env = process.env.DARAJA_ENV || 'sandbox';
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const callback = process.env.DARAJA_CALLBACK_URL || 'https://api.teketeke.org/api/pay/stk/callback';
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
  const password = base64(shortcode + passkey + timestamp);
  const plateRef = normalizeRef(plate || code || '');

  if (!isPlateRef(plateRef)) {
    return res.status(400).json({ error: 'Valid matatu plate is required for STK' });
  }

  if (!shortcode || !passkey) {
    // Fallback mock
    return res.json({
      phone,
      amount: Number(amount || 0),
      plate: plateRef,
      ussd_code: plateRef,
      checkout_request_id: 'CHK_' + Math.random().toString(36).slice(2,10).toUpperCase(),
      status: 'QUEUED',
    });
  }
  try{
    const token = await getAccessToken();
    const host = env==='production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Number(amount||0),
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callback,
      AccountReference: plateRef,
      TransactionDesc: 'TekeTeke STK'
    };
    const r = await fetch(host + '/mpesa/stkpush/v1/processrequest', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if(!r.ok) return res.status(500).json(j);
    const checkoutRequestId = j.CheckoutRequestID || null;
    const normalizedMsisdn = normalizeMsisdn(phone);
    const displayMsisdn = maskMsisdn(normalizedMsisdn);
    const msisdnSource = phone ? 'mpesa' : 'missing';
    const msisdnValue = normalizedMsisdn || phone || 'unknown';

    if (checkoutRequestId) {
      try {
        await pool.query(
          `
            INSERT INTO mpesa_c2b_payments
              (paybill_number, account_reference, amount, msisdn, msisdn_normalized, display_msisdn, msisdn_source, receipt, status, raw, checkout_request_id)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, null, 'RECEIVED', $8, $9)
          `,
          [
            shortcode || null,
            plateRef,
            Number(amount || 0),
            msisdnValue,
            normalizedMsisdn || null,
            displayMsisdn || null,
            msisdnSource,
            { request: payload, response: j },
            checkoutRequestId,
          ]
        );
      } catch (err) {
        console.warn('Failed to record STK request:', err.message);
      }
    }
    res.json({
      phone,
      amount: Number(amount || 0),
      plate: plateRef,
      ussd_code: plateRef,
      checkout_request_id: checkoutRequestId,
      status: 'QUEUED',
    });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

router.post('/stk/callback', async (req,res)=>{
  const body = req.body || {};
  const got = req.headers['x-webhook-secret'] || '';
  const secretMismatch = WEBHOOK_SECRET ? got !== WEBHOOK_SECRET : false;

  try {
    // Parse common Daraja STK callback shape
    const cb = body?.Body?.stkCallback;
    if (!cb) {
      await logCallbackAudit({ req, key: null, kind: 'STK_CALLBACK', result: 'ignored', reason: 'missing_callback' });
      return safeAck(res, { ok: true, ignored: true, reason: 'missing_callback' });
    }

    const resultCode = cb?.ResultCode;
    const checkoutRequestId = cb?.CheckoutRequestID || null;
    const items = Array.isArray(cb?.CallbackMetadata?.Item) ? cb.CallbackMetadata.Item : [];
    const getItem = (name) => items.find(i => i?.Name === name)?.Value;

    const receipt = getItem('MpesaReceiptNumber') || null;
    const amount  = Number(getItem('Amount') || 0);
    const msisdnRaw  = String(getItem('PhoneNumber') || '');
    const normalizedMsisdn = normalizeMsisdn(msisdnRaw);
    const displayMsisdn = maskMsisdn(normalizedMsisdn);
    const msisdnSource = msisdnRaw ? 'mpesa' : 'missing';
    const msisdnValue = normalizedMsisdn || msisdnRaw || 'unknown';

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
      return safeAck(res, { ok: true, ignored: true, reason: 'invalid_payload', missing: validation.missing });
    }

    const idempotencyKey = receipt || checkoutRequestId || null;
    if (idempotencyKey) {
      const idem = await ensureIdempotent({
        kind: 'STK_CALLBACK',
        key: idempotencyKey,
        payload: { checkoutRequestId, receipt, resultCode },
      });
      if (!idem.firstTime) {
        await logCallbackAudit({
          req,
          key: idempotencyKey,
          kind: 'STK_CALLBACK',
          result: 'ignored',
          reason: 'duplicate',
        });
        return safeAck(res, { ok: true, duplicate_ignored: true });
      }
    }

    let paymentRow = null;
    if (checkoutRequestId) {
      const existing = await pool.query(
        `
          SELECT id, account_reference, status, raw
          FROM mpesa_c2b_payments
          WHERE checkout_request_id = $1
          LIMIT 1
        `,
        [checkoutRequestId]
      );
      if (existing.rows.length) paymentRow = existing.rows[0];
    }

    const mergedRaw =
      paymentRow && paymentRow.raw && typeof paymentRow.raw === 'object'
        ? { ...paymentRow.raw, callback: body }
        : { callback: body };

    if (secretMismatch) {
      console.warn('STK callback rejected: bad webhook secret');
      try {
        let paymentId = null;
        let paymentStatus = null;

        if (checkoutRequestId) {
          const insertRes = await pool.query(
            `
              INSERT INTO mpesa_c2b_payments
                (receipt, msisdn, msisdn_normalized, display_msisdn, msisdn_source, amount, status, raw, checkout_request_id)
              VALUES
                ($1, $2, $3, $4, $5, $6, 'QUARANTINED', $7, $8)
              ON CONFLICT (checkout_request_id) DO UPDATE
                SET receipt = COALESCE(EXCLUDED.receipt, mpesa_c2b_payments.receipt),
                    msisdn = COALESCE(EXCLUDED.msisdn, mpesa_c2b_payments.msisdn),
                    msisdn_normalized = COALESCE(EXCLUDED.msisdn_normalized, mpesa_c2b_payments.msisdn_normalized),
                    display_msisdn = COALESCE(EXCLUDED.display_msisdn, mpesa_c2b_payments.display_msisdn),
                    msisdn_source = COALESCE(EXCLUDED.msisdn_source, mpesa_c2b_payments.msisdn_source),
                    amount = COALESCE(EXCLUDED.amount, mpesa_c2b_payments.amount),
                    raw = EXCLUDED.raw,
                    status = CASE
                      WHEN mpesa_c2b_payments.status IN ('CREDITED', 'REJECTED', 'QUARANTINED') THEN mpesa_c2b_payments.status
                      ELSE 'QUARANTINED'
                    END
              RETURNING id, status
            `,
            [
              receipt,
              msisdnValue,
              normalizedMsisdn || null,
              displayMsisdn || null,
              msisdnSource,
              amount,
              mergedRaw,
              checkoutRequestId,
            ]
          );
          paymentId = insertRes.rows[0]?.id || null;
          paymentStatus = insertRes.rows[0]?.status || null;
        } else {
          const insertRes = await pool.query(
            `
              INSERT INTO mpesa_c2b_payments
                (receipt, msisdn, msisdn_normalized, display_msisdn, msisdn_source, amount, status, raw, checkout_request_id)
              VALUES
                ($1, $2, $3, $4, $5, $6, 'QUARANTINED', $7, $8)
              RETURNING id, status
            `,
            [
              receipt,
              msisdnValue,
              normalizedMsisdn || null,
              displayMsisdn || null,
              msisdnSource,
              amount,
              mergedRaw,
              null,
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
            [null, paymentRow?.account_reference || null, amount, msisdn || null, mergedRaw]
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
        console.warn('Failed to quarantine STK webhook mismatch:', err.message);
      }

      await logCallbackAudit({
        req,
        key: checkoutRequestId || receipt || null,
        kind: 'STK_CALLBACK',
        result: 'ignored',
        reason: 'secret_mismatch',
      });
      return safeAck(res, { ok: true, ignored: true, reason: 'secret_mismatch' });
    }

    if (paymentRow) {
      const nextStatus = resultCode === 0 ? 'RECEIVED' : 'REJECTED';
      const updateRes = await pool.query(
        `
          UPDATE mpesa_c2b_payments
          SET receipt = COALESCE($1, receipt),
              msisdn = COALESCE($2, msisdn),
              msisdn_normalized = COALESCE($3, msisdn_normalized),
              display_msisdn = COALESCE($4, display_msisdn),
              msisdn_source = COALESCE($5, msisdn_source),
              amount = COALESCE($6, amount),
              status = CASE
                WHEN status IN ('CREDITED', 'REJECTED', 'QUARANTINED') THEN status
                ELSE $7
              END,
              raw = $8
          WHERE id = $9
          RETURNING id, account_reference, status, raw
        `,
        [
          receipt,
          normalizedMsisdn || null,
          normalizedMsisdn || null,
          displayMsisdn || null,
          msisdnSource,
          amount,
          nextStatus,
          mergedRaw,
          paymentRow.id,
        ]
      );
      paymentRow = updateRes.rows[0] || paymentRow;
    } else if (checkoutRequestId) {
      const insertRes = await pool.query(
        `
          INSERT INTO mpesa_c2b_payments
            (receipt, msisdn, msisdn_normalized, display_msisdn, msisdn_source, amount, status, raw, checkout_request_id)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (checkout_request_id) DO UPDATE
            SET receipt = COALESCE(EXCLUDED.receipt, mpesa_c2b_payments.receipt),
                msisdn = COALESCE(EXCLUDED.msisdn, mpesa_c2b_payments.msisdn),
                msisdn_normalized = COALESCE(EXCLUDED.msisdn_normalized, mpesa_c2b_payments.msisdn_normalized),
                display_msisdn = COALESCE(EXCLUDED.display_msisdn, mpesa_c2b_payments.display_msisdn),
                msisdn_source = COALESCE(EXCLUDED.msisdn_source, mpesa_c2b_payments.msisdn_source),
                amount = COALESCE(EXCLUDED.amount, mpesa_c2b_payments.amount),
                raw = EXCLUDED.raw,
                status = CASE
                  WHEN mpesa_c2b_payments.status IN ('CREDITED', 'REJECTED', 'QUARANTINED') THEN mpesa_c2b_payments.status
                  ELSE EXCLUDED.status
                END
          RETURNING id, account_reference, status, raw
        `,
        [
          receipt,
          msisdnValue,
          normalizedMsisdn || null,
          displayMsisdn || null,
          msisdnSource,
          amount,
          resultCode === 0 ? 'RECEIVED' : 'REJECTED',
          mergedRaw,
          checkoutRequestId,
        ]
      );
      paymentRow = insertRes.rows[0];
    }

    const tx = {
      sacco_id: null,
      matatu_id: null,
      kind: 'SACCO_FEE',
      fare_amount_kes: amount,
      service_fee_kes: 0,
      status: (resultCode === 0 ? 'SUCCESS' : 'FAILED'),
      passenger_msisdn: msisdn || null,
      notes: `STK callback code=${resultCode}`,
      external_id: receipt || null,
      checkout_request_id: cb?.CheckoutRequestID || null
    };

    if (supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from('transactions')
        .insert(tx)
        .select('id')
        .single();
      if (error && !String(error.message||'').toLowerCase().includes('duplicate')) {
        console.warn('STK callback transaction insert failed:', error.message);
      }
    }

    if (resultCode !== 0) {
      return res.status(200).json({ ok: true });
    }

    if (paymentRow && paymentRow.status && paymentRow.status !== 'RECEIVED') {
      return res.status(200).json({ ok: true });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      console.warn('STK callback invalid amount', { checkoutRequestId, receipt, amount });
      if (paymentRow) {
        await pool.query(
          `UPDATE mpesa_c2b_payments SET status = 'REJECTED' WHERE id = $1 AND status = 'RECEIVED'`,
          [paymentRow.id]
        );
      }
      return res.status(200).json({ ok: true });
    }

    const plateRef = normalizeRef(paymentRow?.account_reference || '');
    if (!isPlateRef(plateRef)) {
      console.warn('STK callback missing/invalid plate reference', { checkoutRequestId, receipt });
      if (paymentRow) {
        const updateRes = await pool.query(
          `UPDATE mpesa_c2b_payments SET status = 'QUARANTINED' WHERE id = $1 AND status = 'RECEIVED'`,
          [paymentRow.id]
        );
        if (updateRes.rowCount) {
          await pool.query(
            `
              INSERT INTO mpesa_c2b_quarantine
                (paybill_number, account_reference, amount, msisdn, raw, reason)
              VALUES
                ($1, $2, $3, $4, $5, 'INVALID_PLATE_REF')
            `,
            [null, paymentRow.account_reference || null, amount, msisdn || null, mergedRaw]
          );
        }
        try {
          await applyRiskRules({ paymentId: paymentRow.id, reasonCodes: ['UNKNOWN_ACCOUNT_REF'] });
        } catch (err) {
          console.warn('Risk engine failed for STK invalid plate:', err.message);
        }
      }
      return res.status(200).json({ ok: true });
    }

    const walletId = await resolveWalletByRef(plateRef);
    if (!walletId) {
      console.warn('STK callback unknown plate reference', { checkoutRequestId, plateRef });
      if (paymentRow) {
        const updateRes = await pool.query(
          `UPDATE mpesa_c2b_payments SET status = 'QUARANTINED' WHERE id = $1 AND status = 'RECEIVED'`,
          [paymentRow.id]
        );
        if (updateRes.rowCount) {
          await pool.query(
            `
              INSERT INTO mpesa_c2b_quarantine
                (paybill_number, account_reference, amount, msisdn, raw, reason)
              VALUES
                ($1, $2, $3, $4, $5, 'UNKNOWN_ACCOUNT_REF')
            `,
            [null, paymentRow.account_reference || null, amount, msisdn || null, mergedRaw]
          );
        }
        try {
          await applyRiskRules({ paymentId: paymentRow.id, reasonCodes: ['UNKNOWN_ACCOUNT_REF'] });
        } catch (err) {
          console.warn('Risk engine failed for STK unknown plate:', err.message);
        }
      }
      return res.status(200).json({ ok: true });
    }

    if (paymentRow) {
      try {
        const risk = await applyRiskRules({ paymentId: paymentRow.id, reasonCodes: [] });
        if (risk && risk.risk_level === 'HIGH') {
          const updateRes = await pool.query(
            `UPDATE mpesa_c2b_payments SET status = 'QUARANTINED' WHERE id = $1 AND status = 'RECEIVED'`,
            [paymentRow.id]
          );
          if (updateRes.rowCount) {
            await pool.query(
              `
                INSERT INTO mpesa_c2b_quarantine
                  (paybill_number, account_reference, amount, msisdn, raw, reason)
                VALUES
                  ($1, $2, $3, $4, $5, 'HIGH_RISK')
              `,
              [null, paymentRow.account_reference || null, amount, msisdn || null, mergedRaw]
            );
          }
          return res.status(200).json({ ok: true });
        }
      } catch (err) {
        console.warn('Risk engine failed for STK payment:', err.message);
      }
    }

    const sourceRef = receipt || checkoutRequestId || (paymentRow ? String(paymentRow.id) : null);
    if (sourceRef) {
      const existing = await pool.query(
        `
          SELECT id
          FROM wallet_ledger
          WHERE reference_type = 'MPESA_C2B' AND reference_id = $1
          LIMIT 1
        `,
        [String(paymentRow?.id || sourceRef)]
      );
      if (existing.rows.length) {
        if (paymentRow) {
          await pool.query(
            `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status = 'RECEIVED'`,
            [paymentRow.id]
          );
          try {
            await applyRiskRules({ paymentId: paymentRow.id, reasonCodes: ['IDEMPOTENT_REPLAY'] });
          } catch (err) {
            console.warn('Risk engine failed for STK duplicate:', err.message);
          }
        }
        return res.status(200).json({ ok: true });
      }
    }

    const client = await pool.connect();
    let ledgerResult = null;
    let creditSucceeded = false;
    try {
      await client.query('BEGIN');
      if (paymentRow?.id) {
        const locked = await client.query(
          `
            SELECT status
            FROM mpesa_c2b_payments
            WHERE id = $1
            FOR UPDATE
          `,
          [paymentRow.id]
        );
        const lockedStatus = locked.rows[0]?.status;
        if (lockedStatus !== 'RECEIVED') {
          await client.query('ROLLBACK');
          return res.status(200).json({ ok: true });
        }
      }
      const providerRef = receipt || checkoutRequestId || (paymentRow ? String(paymentRow.id) : null);
      ledgerResult = await creditFareWithFeesByWalletId({
        walletId,
        amount,
        source: 'MPESA_STK',
        sourceRef: providerRef || null,
        referenceId: paymentRow?.id || providerRef || null,
        referenceType: 'MPESA_C2B',
        description: `STK payment from ${msisdn || 'unknown'}`,
        provider: 'mpesa',
        providerRef,
        client,
      });
      if (paymentRow) {
        const updated = await client.query(
          `UPDATE mpesa_c2b_payments SET status = 'CREDITED' WHERE id = $1 AND status = 'RECEIVED'`,
          [paymentRow.id]
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return res.status(200).json({ ok: true });
        }
      }
      await client.query('COMMIT');
      creditSucceeded = true;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error crediting wallet for STK:', err.message);
      if (paymentRow) {
        await pool.query(
          `UPDATE mpesa_c2b_payments SET status = 'REJECTED' WHERE id = $1 AND status = 'RECEIVED'`,
          [paymentRow.id]
        );
      }
    } finally {
      client.release();
    }

    await logCallbackAudit({
      req,
      key: idempotencyKey || sourceRef || checkoutRequestId || null,
      kind: 'STK_CALLBACK',
      result: creditSucceeded ? (ledgerResult?.deduped ? 'accepted_deduped' : 'accepted') : 'rejected',
      reason: creditSucceeded ? undefined : 'credit_failed',
    });
    return safeAck(res, { ok: true });
  } catch (err) {
    console.error('STK callback error:', err.message);
    await logCallbackAudit({
      req,
      key: null,
      kind: 'STK_CALLBACK',
      result: 'rejected',
      reason: 'server_error',
      payload: { error: err.message },
    });
    return safeAck(res, { ok: true, accepted: false, error: 'server_error' });
  }
});

module.exports = router;
