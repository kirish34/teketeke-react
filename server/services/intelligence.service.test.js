import { describe, it, expect } from 'vitest';
import { systemOverview, systemTrends, topEntities } from './intelligence.service';

function makeDb(rowsMap = {}) {
  return {
    async query(sql, params) {
      if (/FROM saccos WHERE created_at/.test(sql)) return { rows: [rowsMap.growth || {}] };
      if (/FROM wallet_ledger WHERE entry_type/.test(sql)) return { rows: [rowsMap.revenue || {}] };
      if (/FROM admin_audit_logs/.test(sql) && /mpesa_callback/.test(sql)) {
        return { rows: [rowsMap.payments || {}] };
      }
      if (/FROM payout_items/.test(sql) && /status = 'FAILED'/.test(sql)) return { rows: [rowsMap.payouts || {}] };
      if (/FROM recon_items/.test(sql)) return { rows: [rowsMap.recon || {}] };
      if (/FROM fraud_alerts/.test(sql)) return { rows: [rowsMap.fraud || {}] };
      if (/FROM quarantined_operations/.test(sql)) return { rows: [rowsMap.quarantine || {}] };
      if (/FROM payout_batches/.test(sql)) return { rows: rowsMap.topSaccos || [] };
      return { rows: [] };
    },
  };
}

describe('intelligence.service', () => {
  it('computes system overview aggregates', async () => {
    const db = makeDb({
      growth: { saccos_new: 2, vehicles_new: 5, active_vehicles: 10, active_saccos: 3 },
      revenue: { fees_collected: 1000, payouts_total: 500, net_flow: 400 },
      payments: { accepted: 8, duplicate: 1, failed: 1, total: 10, c2b: 6, stk: 4 },
      payouts: { failed: 1, total: 5 },
      recon: { exceptions: 2 },
      fraud: { open_high: 1 },
      quarantine: { open_quarantine: 1 },
      topSaccos: [{ sacco_id: 's1', name: 'Alpha', volume: 1000, items: 5 }],
    });
    const res = await systemOverview({ from: null, to: null, db });
    expect(res.ok).toBe(true);
    expect(res.growth.saccos_new).toBe(2);
    expect(res.payments.success_rate).toBe('80.0');
    expect(res.ops.fraud_open_high).toBe(1);
  });

  it('returns trends empty for unknown metric', async () => {
    const res = await systemTrends({ metric: 'unknown', from: null, to: null });
    expect(res.points.length).toBe(0);
  });

  it('returns empty for unknown topEntities kind', async () => {
    const res = await topEntities({ kind: 'none', from: null, to: null });
    expect(res.items.length).toBe(0);
  });
});
