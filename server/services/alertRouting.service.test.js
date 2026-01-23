import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sms/sms.service', () => ({
  queueSms: vi.fn(() => Promise.resolve({ id: 'sms1' })),
}));

import { notifyOnHighSeverity } from './alertRouting.service';
import { queueSms } from '../sms/sms.service';

function makeDb(responses = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM user_roles/i.test(sql)) return { rows: responses.userRoles || [] };
      if (/FROM staff_profiles/i.test(sql)) return { rows: responses.staff || [] };
      return { rows: [] };
    },
  };
}

describe('alertRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends notification for high severity alerts', async () => {
    const prev = process.env.ALERT_NOTIFY_CHANNEL;
    process.env.ALERT_NOTIFY_CHANNEL = 'CONSOLE';
    const db = makeDb({ userRoles: [{ user_id: 'u1', role: 'super_admin', phone: '254700000001' }] });
    try {
      const res = await notifyOnHighSeverity({
        alert: { id: 'a1', severity: 'high', status: 'open', summary: 'Test alert', type: 'DUP' },
        db,
      });
      expect(res.sent).toBe(true);
      expect(queueSms).not.toHaveBeenCalled();
      const update = db.calls.find((c) => /UPDATE fraud_alerts/i.test(c.sql));
      expect(update?.params?.[2]).toBe(1);
    } finally {
      process.env.ALERT_NOTIFY_CHANNEL = prev;
    }
  });

  it('respects cooldown', async () => {
    const db = makeDb({ userRoles: [{ user_id: 'u1', role: 'super_admin', phone: '254700000001' }] });
    const res = await notifyOnHighSeverity({
      alert: {
        id: 'a2',
        severity: 'high',
        status: 'open',
        summary: 'cooldown test',
        type: 'DUP',
        last_notified_at: new Date().toISOString(),
      },
      db,
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('cooldown');
    expect(queueSms).not.toHaveBeenCalled();
  });
});
