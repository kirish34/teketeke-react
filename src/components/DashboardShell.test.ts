import { describe, expect, it } from 'vitest'
import { navLinks } from './DashboardShell'

describe('navLinks', () => {
  it('does not include legacy payouts link', () => {
    const payouts = navLinks.find((l) => l.label === 'Payouts')
    expect(payouts).toBeUndefined()
  })
})
