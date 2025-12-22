import { describe, expect, it } from 'vitest'
import { sanitizeNext } from './Login'

describe('sanitizeNext', () => {
  it('returns root for unsafe paths', () => {
    expect(sanitizeNext('http://evil.com')).toBe('/')
    expect(sanitizeNext(null)).toBe('/')
  })

  it('keeps same-origin paths', () => {
    expect(sanitizeNext('/dashboard')).toBe('/dashboard')
  })
})
