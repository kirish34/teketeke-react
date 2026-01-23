import { describe, it, expect } from 'vitest';
import { computeMatches } from './reconciliation.service';

describe('reconciliation.computeMatches', () => {
  it('marks missing_internal when no candidates', () => {
    const res = computeMatches('C2B', [{ provider_ref: 'ABC', amount: 100 }], []);
    expect(res[0].status).toBe('missing_internal');
  });

  it('marks duplicate when multiple candidates', () => {
    const res = computeMatches(
      'C2B',
      [{ provider_ref: 'ABC', amount: 100 }],
      [
        { id: '1', amount: 100, reference_id: 'ABC' },
        { id: '2', amount: 100, reference_id: 'ABC' },
      ],
    );
    expect(res[0].status).toBe('duplicate');
  });

  it('detects mismatch_amount', () => {
    const res = computeMatches(
      'C2B',
      [{ provider_ref: 'ABC', amount: 100 }],
      [{ id: '1', amount: 50, reference_id: 'ABC' }],
    );
    expect(res[0].status).toBe('mismatch_amount');
  });

  it('matches B2C against provider refs', () => {
    const res = computeMatches(
      'B2C',
      [{ provider_ref: 'REF1', amount: 10 }],
      [{ id: 'pi1', amount: 10, provider_request_id: 'REF1' }],
    );
    expect(res[0].status).toBe('matched');
    expect(res[0].internal_ref).toBe('pi1');
  });
});
