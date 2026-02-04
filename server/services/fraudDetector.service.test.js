import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock monitoring.parseRange used inside detector
vi.mock('./monitoring.service', () => ({
  parseRange: ({ from, to }) => ({ fromTs: new Date(from || 0), toTs: new Date(to || Date.now()) }),
}));
import { detectDuplicateAttempts, detectPayoutFailureSpike } from './fraudDetector.service';

function mockPool(rowsMap) {
  return {
    async query(sql, params) {
      if (/mpesa_callback/.test(sql) && /duplicate/.test(sql)) return { rows: rowsMap.dup || [] };
      if (/withdrawals/.test(sql) && /FAILED/.test(sql)) return { rows: rowsMap.payout || [] };
      return { rows: [] };
    },
  };
}

describe('fraudDetector', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('detectDuplicateAttempts flags duplicates', async () => {
    const db = mockPool({
      dup: [
        { kind: 'C2B', provider_ref: 'T123', count: 3, first_at: new Date().toISOString(), last_at: new Date().toISOString() },
      ],
    });
    const alerts = await detectDuplicateAttempts({ from: new Date(), to: new Date(), db });
    expect(alerts[0].type).toBe('DUPLICATE_ATTEMPT');
  });

  it('detectPayoutFailureSpike flags spikes', async () => {
    const db = mockPool({
      payout: [{ key: '254700', count: 6, first_at: new Date().toISOString(), last_at: new Date().toISOString() }],
    });
    const alerts = await detectPayoutFailureSpike({ db });
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('PAYOUT_FAILURE_SPIKE');
  });
});
