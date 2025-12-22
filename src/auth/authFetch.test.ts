import { describe, expect, it, vi } from 'vitest'
import { authFetch } from '../lib/auth'

// Minimal stub: inject global fetch to capture headers
describe('authFetch', () => {
  it('passes through absolute URLs untouched', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') })
    // @ts-expect-error override global
    global.fetch = spy

    await authFetch('https://example.com/api', { method: 'GET' })
    expect(spy).toHaveBeenCalledWith('https://example.com/api', { method: 'GET' })
  })
})
