import { describe, expect, it } from 'vitest'

// Simple unit for the thresholds logic
function isStale(lastMs: number | null, maxMin: number) {
  if (!lastMs) return true
  const diffMin = Math.floor((Date.now() - lastMs) / 60000)
  return diffMin > maxMin
}

describe('payout health helpers', () => {
  it('detects stale heartbeat when missing', () => {
    expect(isStale(null, 10)).toBe(true)
  })

  it('detects fresh heartbeat within threshold', () => {
    const now = Date.now()
    expect(isStale(now, 10)).toBe(false)
  })

  it('detects stale heartbeat beyond threshold', () => {
    const old = Date.now() - 20 * 60000
    expect(isStale(old, 10)).toBe(true)
  })
})
