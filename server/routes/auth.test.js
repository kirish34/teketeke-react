import { describe, it, expect, vi, beforeAll } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: mockQuery },
  query: mockQuery,
}));
vi.mock('../db/pool.js', () => ({
  __esModule: true,
  default: { query: mockQuery },
  query: mockQuery,
}));

vi.mock('../supabase.js', () => ({
  __esModule: true,
  supabaseAdmin: { auth: { getUser: vi.fn() } },
}));
vi.mock('../supabase', () => ({
  __esModule: true,
  supabaseAdmin: { auth: { getUser: vi.fn() } },
}));

beforeAll(() => {
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.MOCK_SUPABASE_AUTH = '1';
  process.env.MOCK_AUTH_CONTEXT = '1';
  global.__testPool = { query: mockQuery };
});

describe('/api/auth/me handler', () => {
  it('returns context when present', async () => {
    const mod = await import('./auth.js');
    const { handleMe } = mod.__test;
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'user-1',
          email: 'a@example.com',
          effective_role: 'OWNER',
          sacco_id: 's1',
          matatu_id: 'm1',
        },
      ],
    });
    const req = { user: { id: 'user-1', email: 'a@example.com' } };
    const res = {
      statusCode: 200,
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
    await handleMe(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.user?.id).toBe('user-1');
    expect(res.body?.context?.effective_role).toBe('OWNER');
  });

  it('returns needs_setup when context is missing', async () => {
    const prevMockContext = process.env.MOCK_AUTH_CONTEXT;
    process.env.MOCK_AUTH_CONTEXT = 'missing';
    const mod = await import('./auth.js');
    const { handleMe } = mod.__test;
    mockQuery.mockReset();
    // ensureUserContext insert returns a created row
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'user-2',
          email: 'b@example.com',
          effective_role: 'SACCO_ADMIN',
          sacco_id: null,
          matatu_id: null,
        },
      ],
    });
    const req = { user: { id: 'user-2', email: 'b@example.com', app_metadata: { role: 'SACCO_ADMIN' } } };
    const res = {
      statusCode: 200,
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
    await handleMe(req, res);
    process.env.MOCK_AUTH_CONTEXT = prevMockContext;
    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.context_missing).toBe(true);
    expect(res.body?.needs_setup).toBe(true);
    expect(res.body?.context?.effective_role).toBe(null);
    expect(res.body?.user?.email).toBe('b@example.com');
  });
});
