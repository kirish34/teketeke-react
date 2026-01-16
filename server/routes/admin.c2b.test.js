import { describe, it, expect, beforeAll, vi } from 'vitest';

let mapC2bRow;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_ANON_KEY = 'test-key';
  vi.mock('../supabase', () => ({
    __esModule: true,
    supabaseAdmin: null,
  }));
  const mod = await import('./admin.js');
  const router = mod.default || mod;
  mapC2bRow = router.__test.mapC2bRow;
});

describe('admin C2B mapping', () => {
  it('masks or returns Unknown instead of hashed msisdn', () => {
    const mapped = mapC2bRow({
      id: '1',
      receipt: 'ABC',
      msisdn: 'UAE7N5Q1HD', // legacy hash-like string
      msisdn_normalized: null,
      display_msisdn: null,
      amount: 100,
      raw: null,
    });
    expect(mapped.display_msisdn_safe).toBe('Unknown');
    expect(mapped.msisdn).toBeUndefined();
  });
});
