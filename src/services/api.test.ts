import { describe, expect, it } from 'vitest'
import { resolveApiUrl } from './api'

describe('resolveApiUrl', () => {
  it('returns absolute URLs untouched', () => {
    const url = resolveApiUrl('https://example.com/api', 'https://api.local')
    expect(url).toBe('https://example.com/api')
  })

  it('returns path when base is local during dev', () => {
    const url = resolveApiUrl('/api/healthz', 'http://localhost:5001', true)
    expect(url).toBe('/api/healthz')
  })

  it('prefixes base when non-local or prod', () => {
    const url = resolveApiUrl('/api/healthz', 'https://api.prod', false)
    expect(url).toBe('https://api.prod/api/healthz')
  })
})
