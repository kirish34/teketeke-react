import { describe, expect, it } from 'vitest';
import { normalizeMsisdn, maskMsisdn, safeDisplayMsisdn } from './msisdn.js';

describe('normalizeMsisdn', () => {
  it('normalizes 07XXXXXXXX format', () => {
    expect(normalizeMsisdn('0712345678')).toBe('254712345678');
  });

  it('normalizes 7XXXXXXXX format', () => {
    expect(normalizeMsisdn('712345678')).toBe('254712345678');
  });

  it('keeps 2547XXXXXXXX format', () => {
    expect(normalizeMsisdn('254712345678')).toBe('254712345678');
  });

  it('returns null for invalid input', () => {
    expect(normalizeMsisdn('12345')).toBeNull();
    expect(normalizeMsisdn('')).toBeNull();
  });
});

describe('msisdnDisplay', () => {
  it('masks normalized numbers', () => {
    expect(maskMsisdn('0712345678')).toBe('2547******678');
    expect(maskMsisdn('254712345678')).toBe('2547******678');
  });

  it('returns empty string when invalid', () => {
    expect(maskMsisdn('')).toBeNull();
    expect(maskMsisdn(null)).toBeNull();
  });
});

describe('safeDisplayMsisdn', () => {
  it('prefers provided display', () => {
    expect(safeDisplayMsisdn({ display_msisdn: '2547******123', msisdn_normalized: '254700000123' })).toBe(
      '2547******123',
    );
  });

  it('falls back to masked normalized', () => {
    expect(safeDisplayMsisdn({ display_msisdn: null, msisdn_normalized: '254712345678' })).toBe('2547******678');
  });

  it('returns Unknown when missing', () => {
    expect(safeDisplayMsisdn({ display_msisdn: null, msisdn_normalized: null })).toBe('Unknown');
  });
});
