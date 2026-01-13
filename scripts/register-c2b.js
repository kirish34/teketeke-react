#!/usr/bin/env node
/**
 * Register Daraja C2B Validation + Confirmation URLs (Production).
 *
 * Requires env:
 *  MPESA_BASE_URL=https://api.safaricom.co.ke
 *  MPESA_CONSUMER_KEY=...
 *  MPESA_CONSUMER_SECRET=...
 *  MPESA_C2B_SHORTCODE=...
 *  MPESA_C2B_VALIDATION_URL=https://api.teketeke.org/mpesa/c2b/validation
 *  MPESA_C2B_CONFIRMATION_URL=https://api.teketeke.org/mpesa/c2b/confirmation
 */

import dotenv from 'dotenv';

dotenv.config();

const {
  MPESA_BASE_URL,
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_C2B_SHORTCODE,
  MPESA_C2B_VALIDATION_URL,
  MPESA_C2B_CONFIRMATION_URL,
} = process.env;

function must(name, val) {
  const cleaned = (val || '').trim();
  if (!cleaned) {
    console.error(`[register-c2b] Missing env: ${name}`);
    process.exit(1);
  }
  return cleaned;
}

async function getToken() {
  const base = must('MPESA_BASE_URL', MPESA_BASE_URL).replace(/\/$/, '');
  const key = must('MPESA_CONSUMER_KEY', MPESA_CONSUMER_KEY);
  const secret = must('MPESA_CONSUMER_SECRET', MPESA_CONSUMER_SECRET);

  const auth = Buffer.from(`${key}:${secret}`).toString('base64');

  const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text for error message below
  }

  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }
  if (!data.access_token) {
    throw new Error(`Token response missing access_token: ${text}`);
  }
  return data.access_token;
}

async function registerUrls() {
  const base = must('MPESA_BASE_URL', MPESA_BASE_URL).replace(/\/$/, '');
  const shortcode = must('MPESA_C2B_SHORTCODE', MPESA_C2B_SHORTCODE);
  const validation = must('MPESA_C2B_VALIDATION_URL', MPESA_C2B_VALIDATION_URL);
  const confirmation = must('MPESA_C2B_CONFIRMATION_URL', MPESA_C2B_CONFIRMATION_URL);
  const responseType = process.env.MPESA_C2B_RESPONSE_TYPE || 'Completed';

  const token = await getToken();

  console.log('[register-c2b] Using:', {
    base,
    shortcode,
    validation,
    confirmation,
    responseType,
    tokenLength: token.length,
  });

  const payload = {
    ShortCode: shortcode,
    ResponseType: responseType, // recommended: Completed
    ConfirmationURL: confirmation,
    ValidationURL: validation,
  };

  const res = await fetch(`${base}/mpesa/c2b/v1/registerurl`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RegisterURL failed (${res.status}): ${text}`);
  }

  console.log('[register-c2b] Success:', text);
}

registerUrls().catch((e) => {
  console.error('[register-c2b] ERROR:', e.message || e);
  process.exit(1);
});
