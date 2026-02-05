/**
 * Conditional env validation for Supabase + Daraja.
 *
 * Flags:
 *  - ENABLE_STK=true|false  (default: true)
 *  - ENABLE_B2C=true|false  (default: false)
 *  - REQUIRE_TELEMETRY=true|false (default: false)
 *
 * Fails with exit code 1 if required vars are missing.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

function bool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return String(v).toLowerCase() === 'true';
}

const ENABLE_STK = bool(process.env.ENABLE_STK, true);
const ENABLE_B2C = bool(process.env.ENABLE_B2C, false);
const REQUIRE_TELEMETRY = bool(process.env.REQUIRE_TELEMETRY, false);
const REQUIRE_WEBHOOK = bool(process.env.MPESA_C2B_REQUIRE_SECRET, false);

// Always required for backend
const requiredBase = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

// STK required set
const requiredSTK = [
  'DARAJA_SHORTCODE',
  'DARAJA_PASSKEY',
  'DARAJA_CALLBACK_URL',
];

// B2C required set
const requiredB2C = [
  'MPESA_B2C_SHORTCODE',
  'MPESA_B2C_INITIATOR_NAME',
  'MPESA_B2C_SECURITY_CREDENTIAL',
  'MPESA_B2C_RESULT_URL',
  'MPESA_B2C_TIMEOUT_URL',
];

// Optional security extras (turn on if you use it in code)
const requiredWebhook = [
  // 'DARAJA_WEBHOOK_SECRET',
];

function buildRequiredList() {
  const req = [...requiredBase];

  const hasDbUrl = Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
  if (!hasDbUrl) {
    req.push('SUPABASE_DB_URL or DATABASE_URL');
  }

  const hasMpesaOAuth = Boolean(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET);
  const hasDarajaOAuth = Boolean(process.env.DARAJA_CONSUMER_KEY && process.env.DARAJA_CONSUMER_SECRET);

  // If STK or B2C is enabled, we must have OAuth
  if ((ENABLE_STK || ENABLE_B2C) && !hasMpesaOAuth && !hasDarajaOAuth) {
    req.push('MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET or DARAJA_CONSUMER_KEY/DARAJA_CONSUMER_SECRET');
  }

  if (ENABLE_STK) req.push(...requiredSTK);
  if (ENABLE_B2C) req.push(...requiredB2C);

  if (REQUIRE_TELEMETRY) req.push('TELEMETRY_TOKEN');
  if (REQUIRE_WEBHOOK) req.push('DARAJA_WEBHOOK_SECRET');

  // If you enforce webhook verification, add it here
  // req.push(...requiredWebhook);

  return req;
}

export function getMissingEnv(envObj) {
  const required = buildRequiredList();
  return required.filter((k) => !envObj[k] || String(envObj[k]).trim() === '');
}

function main() {
  const missing = getMissingEnv(process.env);

  if (missing.length) {
    console.error('[validate-env] Missing required env vars:\n  - ' + missing.join('\n  - '));
    console.error(
      `[validate-env] Flags: ENABLE_STK=${ENABLE_STK} ENABLE_B2C=${ENABLE_B2C} REQUIRE_TELEMETRY=${REQUIRE_TELEMETRY}`
    );
    process.exit(1);
  }

  console.log('[validate-env] OK');
  console.log(
    `[validate-env] Flags: ENABLE_STK=${ENABLE_STK} ENABLE_B2C=${ENABLE_B2C} REQUIRE_TELEMETRY=${REQUIRE_TELEMETRY}`
  );
}

const isMain = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
