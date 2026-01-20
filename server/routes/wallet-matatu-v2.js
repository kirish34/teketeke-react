const express = require('express');
const pool = require('../db/pool');
const { requireUserV2, requireMatatuRoleV2 } = require('../middleware/authz.v2');

const router = express.Router();

router.use(requireUserV2);
router.use(requireMatatuRoleV2(['OWNER', 'SYSTEM_ADMIN']));

router.get('/wallets', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, wallet_kind, balance, updated_at
        FROM wallets
        WHERE matatu_id = $1
        ORDER BY wallet_kind
      `,
      [req.matatuId],
    );
    return res.json({ ok: true, matatu_id: req.matatuId, wallets: rows || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load wallets', request_id: req.requestId });
  }
});

router.get('/wallet-ledger', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Math.min(Math.max(limitRaw || 0, 1), 500);
    const from = (req.query.from || '').toString().trim();
    const to = (req.query.to || '').toString().trim();

    const params = [req.matatuId, limit];
    const where = ['w.matatu_id = $1'];
    if (from) {
      params.push(from);
      where.push(`wl.created_at::date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`wl.created_at::date <= $${params.length}`);
    }

    const { rows } = await pool.query(
      `
        SELECT wl.*, w.wallet_kind, w.virtual_account_code
        FROM wallet_ledger wl
        JOIN wallets w ON w.id = wl.wallet_id
        WHERE ${where.join(' AND ')}
        ORDER BY wl.created_at DESC
        LIMIT $2
      `,
      params,
    );
    return res.json({ ok: true, matatu_id: req.matatuId, items: rows || [] });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: err.message || 'Failed to load wallet ledger', request_id: req.requestId });
  }
});

module.exports = router;
