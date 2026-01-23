import { describe, it, expect } from 'vitest';
import {
  ensureIdempotent,
  validateRequired,
  verifyShortcode,
} from './callbackHardening.service';

describe('callbackHardening', () => {
  it('tracks idempotency in memory store during tests', async () => {
    const first = await ensureIdempotent({ kind: 'TEST_KIND', key: 'abc123' });
    const second = await ensureIdempotent({ kind: 'TEST_KIND', key: 'abc123' });
    expect(first.firstTime).toBe(true);
    expect(second.firstTime).toBe(false);
  });

  it('validates required fields', () => {
    const result = validateRequired({ a: 1, b: null }, ['a', 'b', 'c']);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('b');
    expect(result.missing).toContain('c');
  });

  it('verifies shortcode when expected is provided', () => {
    const ok = verifyShortcode({ received: '1234', expected: '1234' });
    const bad = verifyShortcode({ received: '9999', expected: '1234' });
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
  });
});
