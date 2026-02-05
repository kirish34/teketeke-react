type Env = Record<string, string | undefined>

function bool(v: string | undefined, def: boolean) {
  if (!v) return def
  return v.toLowerCase() === 'true'
}

export function getMissingEnv(env: Env) {
  const ENABLE_STK = bool(env.ENABLE_STK, true)
  const ENABLE_B2C = bool(env.ENABLE_B2C, false)
  const REQUIRE_TELEMETRY = bool(env.REQUIRE_TELEMETRY, false)
  const REQUIRE_WEBHOOK = bool(env.MPESA_C2B_REQUIRE_SECRET, false)

  const requiredBase = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  const requiredSTK = ['DARAJA_SHORTCODE', 'DARAJA_PASSKEY', 'DARAJA_CALLBACK_URL']
  const requiredB2C = [
    'MPESA_B2C_SHORTCODE',
    'MPESA_B2C_INITIATOR_NAME',
    'MPESA_B2C_SECURITY_CREDENTIAL',
    'MPESA_B2C_RESULT_URL',
    'MPESA_B2C_TIMEOUT_URL',
  ]

  const missing: string[] = []

  for (const key of requiredBase) {
    if (!env[key] || String(env[key]).trim() === '') missing.push(key)
  }

  const hasDbUrl = Boolean(env.SUPABASE_DB_URL || env.DATABASE_URL)
  if (!hasDbUrl) missing.push('SUPABASE_DB_URL or DATABASE_URL')

  const hasMpesaOAuth =
    Boolean(env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET)
  const hasDarajaOAuth =
    Boolean(env.DARAJA_CONSUMER_KEY && env.DARAJA_CONSUMER_SECRET)

  if ((ENABLE_STK || ENABLE_B2C) && !hasMpesaOAuth && !hasDarajaOAuth) {
    missing.push('MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET or DARAJA_CONSUMER_KEY/DARAJA_CONSUMER_SECRET')
  }

  if (ENABLE_STK) {
    for (const key of requiredSTK) {
      if (!env[key] || String(env[key]).trim() === '') missing.push(key)
    }
  }
  if (ENABLE_B2C) {
    for (const key of requiredB2C) {
      if (!env[key] || String(env[key]).trim() === '') missing.push(key)
    }
  }
  if (REQUIRE_TELEMETRY && (!env.TELEMETRY_TOKEN || String(env.TELEMETRY_TOKEN).trim() === '')) {
    missing.push('TELEMETRY_TOKEN')
  }
  if (REQUIRE_WEBHOOK && (!env.DARAJA_WEBHOOK_SECRET || String(env.DARAJA_WEBHOOK_SECRET).trim() === '')) {
    missing.push('DARAJA_WEBHOOK_SECRET')
  }

  return missing
}
