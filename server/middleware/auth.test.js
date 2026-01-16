import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getSession: vi.fn() },
  })),
}));

const mockGetUser = vi.fn();

vi.mock('../supabase', () => ({
  __esModule: true,
  supabaseAdmin: { auth: { getUser: (...args) => mockGetUser(...args) } },
}));

vi.mock('../supabase.js', () => ({
  __esModule: true,
  supabaseAdmin: { auth: { getUser: (...args) => mockGetUser(...args) } },
}));

beforeAll(() => {
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
});

beforeEach(() => {
  process.env.MOCK_SUPABASE_AUTH = '0';
});

beforeEach(() => {
  mockGetUser.mockReset();
});

describe('requireUser middleware', () => {
  it('returns 401 when token missing', async () => {
    const { requireUser } = await import('./auth.js');
    const req = { headers: {} };
    const res = {
      statusCode: 0,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    let nextCalled = false;
    await requireUser(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'missing token' });
  });

  it('returns 403 when supabase rejects token', async () => {
    const { requireUser } = await import('./auth.js');
    process.env.MOCK_SUPABASE_AUTH = 'fail';
    mockGetUser.mockResolvedValueOnce({ data: null, error: new Error('bad') });
    const req = { headers: { authorization: 'Bearer badtoken' } };
    const res = {
      statusCode: 0,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    let nextCalled = false;
    await requireUser(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'invalid token' });
  });
});
