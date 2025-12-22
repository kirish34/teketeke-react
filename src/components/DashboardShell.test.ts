import { describe, expect, it } from 'vitest'
import { navLinks } from './DashboardShell'

describe('navLinks', () => {
  it('exposes Payouts only to admins', () => {
    const payouts = navLinks.find((l) => l.label === 'Payouts')
    expect(payouts?.allow).toEqual(['super_admin', 'system_admin'])
  })

  it('exposes Approvals to sacco/system/super admins', () => {
    const approvals = navLinks.find((l) => l.label === 'Approvals')
    expect(approvals?.allow).toContain('sacco_admin')
  })
})
