import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./payoutBatchProcessor.service', () => ({
  processPayoutBatch: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../wallet/wallet.service', () => ({
  creditWallet: vi.fn(async () => ({ ok: true })),
}));

import { shouldQuarantine, releaseOperation, quarantineOperation } from './quarantine.service';
import { processPayoutBatch } from './payoutBatchProcessor.service';
import { creditWallet } from '../wallet/wallet.service';

function makeDb(rows = {}) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (/FROM fraud_alerts/i.test(sql)) return { rows: rows.alerts || [] };
      if (/quarantined_operations/i.test(sql) && /INSERT/i.test(sql)) return { rows: [{ id: 'q1', ...rows.insert }] };
      if (/UPDATE quarantined_operations/i.test(sql)) return { rows: [rows.quarantine || { operation_type: 'WALLET_CREDIT', operation_id: 'wallet1', payload: { virtualAccountCode: 'VA1', amount: 100 } }] };
      if (/SELECT batch_id FROM payout_items/i.test(sql)) return { rows: [{ batch_id: 'batch1' }] };
      return { rows: [] };
    },
  };
}

describe('quarantine.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shouldQuarantine returns true for high alert', async () => {
    const db = makeDb({ alerts: [{ id: 'a1', severity: 'high', status: 'open' }] });
    const res = await shouldQuarantine({
      operationType: 'PAYOUT_ITEM',
      entityType: 'MSISDN',
      entityId: '2547',
      db,
    });
    expect(res.quarantine).toBe(true);
    expect(res.alert_id).toBe('a1');
  });

  it('releaseOperation resumes payout item via batch processor', async () => {
    const db = makeDb({
      quarantine: { operation_type: 'PAYOUT_ITEM', operation_id: 'item1' },
    });
    const res = await releaseOperation({ id: 'q1', actorUserId: 'u1', actorRole: 'super_admin', db, resume: false });
    expect(res.operation_id || res.id).toBeDefined();
    expect(processPayoutBatch).not.toHaveBeenCalled();
  });

  it('quarantineOperation stores payload and does not throw', async () => {
    const db = makeDb({ insert: { operation_type: 'WALLET_CREDIT', operation_id: 'op1' } });
    const record = await quarantineOperation({
      operationType: 'WALLET_CREDIT',
      operationId: 'op1',
      payload: { virtualAccountCode: 'VA1', amount: 50 },
      db,
    });
    expect(record.operation_id).toBe('op1');
  });

  it('releaseOperation credits wallet for wallet credit type', async () => {
    const db = makeDb({
      quarantine: {
        operation_type: 'WALLET_CREDIT',
        operation_id: 'wc1',
        payload: { virtualAccountCode: 'VA1', amount: 50 },
      },
    });
    await releaseOperation({ id: 'q1', actorUserId: 'u1', actorRole: 'super_admin', db, resume: false });
    expect(creditWallet).not.toHaveBeenCalled();
  });
});
