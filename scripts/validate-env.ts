type Env = Record<string, string | undefined>

function bool(v: string | undefined, def: boolean) {
  if (!v) return def
  return v.toLowerCase() === 'true'
}

export function getMissingEnv(env: Env) {
  const ENABLE_STK = bool(env.ENABLE_STK, true)
  const ENABLE_B2C = bool(env.ENABLE_B2C, false)
  const REQUIRE_TELEMETRY = bool(env.REQUIRE_TELEMETRY, false)

  const requiredBase = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  const requiredOAuth = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET']
  const requiredSTK = ['DARAJA_SHORTCODE', 'DARAJA_PASSKEY', 'DARAJA_CALLBACK_URL']
  const requiredB2C = [
    'MPESA_B2C_SHORTCODE',
    'MPESA_B2C_INITIATOR_NAME',
    'MPESA_B2C_SECURITY_CREDENTIAL',
    'MPESA_B2C_RESULT_URL',
    'MPESA_B2C_TIMEOUT_URL',
    'MPESA_B2C_PAYOUT_RESULT_URL',
    'MPESA_B2C_PAYOUT_TIMEOUT_URL',
  ]

  const required: string[] = [...requiredBase]

  if (ENABLE_STK || ENABLE_B2C) required.push(...requiredOAuth)
  if (ENABLE_STK) required.push(...requiredSTK)
  if (ENABLE_B2C) required.push(...requiredB2C)
  if (REQUIRE_TELEMETRY) required.push('TELEMETRY_TOKEN')

  return required.filter((k) => !env[k] || String(env[k]).trim() === '')
}
