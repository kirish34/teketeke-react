import { describe, expect, it } from 'vitest'
import { normalizePhoneKE } from './WithdrawalPhones'

describe('normalizePhoneKE', () => {
  it('normalizes 07 numbers to 2547', () => {
    expect(normalizePhoneKE('0712345678')).toBe('254712345678')
  })

  it('normalizes 01 numbers to 2541', () => {
    expect(normalizePhoneKE('0112345678')).toBe('254112345678')
  })

  it('passes through 254 format', () => {
    expect(normalizePhoneKE('254701234567')).toBe('254701234567')
  })

  it('strips plus sign', () => {
    expect(normalizePhoneKE('+254701234567')).toBe('254701234567')
  })
})
