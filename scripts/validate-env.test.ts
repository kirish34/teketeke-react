import { describe, expect, it } from 'vitest'
import { getMissingEnv } from './validate-env.ts'

describe('getMissingEnv flag-aware validation', () => {
  it('flags missing required vars with defaults (STK on, B2C off)', () => {
    const missing = getMissingEnv({})

    expect(missing).toContain('SUPABASE_URL')
    expect(missing).toContain('SUPABASE_ANON_KEY')
    expect(missing).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(missing).toContain('SUPABASE_DB_URL or DATABASE_URL')
    expect(missing).toContain('MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET or DARAJA_CONSUMER_KEY/DARAJA_CONSUMER_SECRET')
    expect(missing).toContain('DARAJA_SHORTCODE')
    expect(missing).not.toContain('MPESA_B2C_SHORTCODE')
  })

  it('passes with STK only when flags set', () => {
    const env = {
      ENABLE_STK: 'true',
      ENABLE_B2C: 'false',

      SUPABASE_URL: 'https://example.com',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'key',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',

      MPESA_CONSUMER_KEY: 'ck',
      MPESA_CONSUMER_SECRET: 'cs',

      DARAJA_SHORTCODE: '123456',
      DARAJA_PASSKEY: 'pass',
      DARAJA_CALLBACK_URL: 'https://callback',
    }

    expect(getMissingEnv(env).length).toBe(0)
  })

  it('passes with B2C only when flags set', () => {
    const env = {
      ENABLE_STK: 'false',
      ENABLE_B2C: 'true',

      SUPABASE_URL: 'https://example.com',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'key',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',

      MPESA_CONSUMER_KEY: 'ck',
      MPESA_CONSUMER_SECRET: 'cs',

      MPESA_B2C_SHORTCODE: '600111',
      MPESA_B2C_INITIATOR_NAME: 'init',
      MPESA_B2C_SECURITY_CREDENTIAL: 'sec',
      MPESA_B2C_RESULT_URL: 'https://result',
      MPESA_B2C_TIMEOUT_URL: 'https://timeout',
    }

    expect(getMissingEnv(env).length).toBe(0)
  })

  it('requires telemetry token when opted in', () => {
    const envWithoutTelemetry = {
      ENABLE_STK: 'false',
      ENABLE_B2C: 'false',
      REQUIRE_TELEMETRY: 'true',
      SUPABASE_URL: 'https://example.com',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'key',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    }

    expect(getMissingEnv(envWithoutTelemetry)).toContain('TELEMETRY_TOKEN')

    const envWithTelemetry = {
      ...envWithoutTelemetry,
      TELEMETRY_TOKEN: 'token',
    }

    expect(getMissingEnv(envWithTelemetry).length).toBe(0)
  })
})
