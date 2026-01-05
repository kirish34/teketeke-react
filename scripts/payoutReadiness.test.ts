import { describe, expect, it, beforeAll } from 'vitest'

let checkB2CEnvPresence: any
let buildBatchReadiness: any

beforeAll(async () => {
  const mod = await import('../server/services/payoutReadiness.service.js')
  const svc = mod.default || mod
  checkB2CEnvPresence = svc.checkB2CEnvPresence
  buildBatchReadiness = svc.buildBatchReadiness
})

describe('payout readiness helpers', () => {
  it('reports missing env keys when unset', () => {
    const res = checkB2CEnvPresence({})
    expect(res.pass).toBe(false)
    expect(res.details?.missing_keys).toContain('MPESA_B2C_SHORTCODE')
    expect(res.details?.missing_keys).toContain('MPESA_B2C_PAYOUT_RESULT_URL')
  })

  it('draft batch with no items cannot submit', () => {
    const readiness = buildBatchReadiness({
      batch: { status: 'DRAFT' },
      summary: { pending_count: 0, blocked_count: 0 },
      pendingMsisdnCount: 0,
      unverifiedMsisdnCount: 0,
      quarantinesCount: 0,
      envCheck: { pass: true, details: {} },
    })
    expect(readiness.checks.can_submit.pass).toBe(false)
  })

  it('submitted batch with unverified destination cannot approve', () => {
    const readiness = buildBatchReadiness({
      batch: { status: 'SUBMITTED' },
      summary: { pending_count: 1, blocked_count: 0 },
      pendingMsisdnCount: 1,
      unverifiedMsisdnCount: 1,
      quarantinesCount: 0,
      envCheck: { pass: true, details: {} },
    })
    expect(readiness.checks.can_approve.pass).toBe(false)
    expect(readiness.issues.some((issue: any) => issue.code === 'DESTINATION_NOT_VERIFIED')).toBe(true)
  })

  it('submitted batch with quarantines cannot approve', () => {
    const readiness = buildBatchReadiness({
      batch: { status: 'SUBMITTED' },
      summary: { pending_count: 1, blocked_count: 0 },
      pendingMsisdnCount: 1,
      unverifiedMsisdnCount: 0,
      quarantinesCount: 2,
      envCheck: { pass: true, details: {} },
    })
    expect(readiness.checks.can_approve.pass).toBe(false)
    expect(readiness.issues.some((issue: any) => issue.code === 'QUARANTINES_PRESENT')).toBe(true)
  })

  it('approved batch with no pending cannot process', () => {
    const readiness = buildBatchReadiness({
      batch: { status: 'APPROVED' },
      summary: { pending_count: 0, blocked_count: 0 },
      pendingMsisdnCount: 0,
      unverifiedMsisdnCount: 0,
      quarantinesCount: 0,
      envCheck: { pass: true, details: {} },
    })
    expect(readiness.checks.can_process.pass).toBe(false)
  })
})
