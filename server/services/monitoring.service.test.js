import { describe, it, expect } from 'vitest';
import {
  getMonitoringOverview,
  listCallbacks,
  listPayouts,
} from './monitoring.service';

function mockDb(rowsMap) {
  return {
    async query(sql, params) {
      // crude routing by keyword
      if (/FROM admin_audit_logs/.test(sql)) return { rows: rowsMap.audit || [] };
      if (/FROM payout_batches/.test(sql)) return { rows: rowsMap.batches || [] };
      if (/FROM payout_items/.test(sql)) return { rows: rowsMap.items || [] };
      if (/FROM wallet_ledger/.test(sql)) return { rows: rowsMap.wallet || [] };
      return { rows: [] };
    },
  };
}

describe('monitoring.service', () => {
  it('computes overview aggregates', async () => {
    const db = mockDb({
      audit: [{ result: 'accepted', count: 3 }, { result: 'duplicate', count: 1 }, { result: 'ignored', count: 2 }],
      batches: [{ status: 'PROCESSING', count: 2 }, { status: 'COMPLETED', count: 1 }],
      items: [
        { status: 'SENT', count: 3, avg_time_sec: 5 },
        { status: 'FAILED', count: 1, avg_time_sec: 15 },
      ],
      wallet: [{ credits: 4, debits: 2, net: 100 }],
    });
    const res = await getMonitoringOverview({ from: new Date(), to: new Date(), db });
    expect(res.callbacks.total).toBe(6);
    expect(res.payouts.items_failed).toBe(1);
    expect(res.wallets.net).toBe(100);
  });

  it('lists callbacks with filters', async () => {
    const db = mockDb({
      audit: [{ created_at: '2020', kind: 'C2B', resource_id: 'A', payload: { result: 'ignored' } }],
    });
    const rows = await listCallbacks({ from: new Date(), to: new Date(), limit: 5, db });
    expect(rows.length).toBe(1);
  });

  it('lists payout failures by default', async () => {
    const db = mockDb({
      items: [{ id: 'pi1', status: 'FAILED', failure_reason: 'x', amount: 10, created_at: '2020' }],
    });
    const rows = await listPayouts({ from: new Date(), to: new Date(), limit: 5, db });
    expect(rows[0]?.status).toBe('FAILED');
  });
});
