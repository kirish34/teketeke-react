import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db/pool.js', () => ({
  __esModule: true,
  default: { query: mockQuery },
  query: mockQuery,
}));
vi.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: mockQuery },
  query: mockQuery,
}));

vi.mock('../middleware/auth', () => ({
  requireUser: (_req, _res, next) => next(),
}));

let canAccessWalletWithContext;
let normalizeRoleName;
let router;

describe('wallet-ledger auth guards', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  beforeAll(async () => {
    const mod = await import('./wallet-ledger.js');
    router = mod.default || mod;
    ({ canAccessWalletWithContext, normalizeRoleName } = router.__test);
  });

  it('normalizes roles for access checks', () => {
    expect(normalizeRoleName('MATATU_OWNER')).toBe('OWNER');
    expect(normalizeRoleName('SACCO')).toBe('SACCO_ADMIN');
  });

  it('allows owner to access their own wallet and blocks others', () => {
    const ownerCtx = { role: 'OWNER', saccoId: null, matatuId: 'mat-1' };
    const ownWallet = { id: 'w1', matatu_id: 'mat-1', sacco_id: null };
    const otherWallet = { id: 'w2', matatu_id: 'mat-2', sacco_id: null };
    expect(canAccessWalletWithContext(ownerCtx, ownWallet)).toBe(true);
    expect(canAccessWalletWithContext(ownerCtx, otherWallet)).toBe(false);
  });

  it('enforces sacco scope for sacco admin/staff wallets', () => {
    const saccoCtx = { role: 'SACCO_ADMIN', saccoId: 'sacco-1', matatuId: null };
    const sameSaccoWallet = { id: 'w3', sacco_id: 'sacco-1' };
    const otherSaccoWallet = { id: 'w4', sacco_id: 'sacco-2' };
    expect(canAccessWalletWithContext(saccoCtx, sameSaccoWallet)).toBe(true);
    expect(canAccessWalletWithContext(saccoCtx, otherSaccoWallet)).toBe(false);
  });
});
