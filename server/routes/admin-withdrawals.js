const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdminAccess } = require('../middleware/admin-access');

router.use(requireAdminAccess);

// List withdrawals (default BANK; filter by status)
router.get('/admin/withdrawals', async (req, res) => {
  const { method = 'BANK', status } = req.query;
  const params = [method];
  let where = 'wdr.method = $1';
  if (status) {
    params.push(status);
    where += ` AND wdr.status = $${params.length}`;
  }
  try {
    const result = await pool.query(
      `
        SELECT wdr.id, wdr.amount, wdr.status, wdr.method,
               wdr.bank_name, wdr.bank_branch, wdr.bank_account_number, wdr.bank_account_name,
               wdr.created_at, wdr.updated_at, wdr.internal_note,
               wa.virtual_account_code,
               wa.entity_type,
               wa.entity_id
        FROM withdrawals wdr
        JOIN wallets wa ON wa.id = wdr.wallet_id
        WHERE ${where}
        ORDER BY wdr.created_at ASC
      `,
      params
    );
    return res.json({ ok: true, items: result.rows || [] });
  } catch (err) {
    console.error('Error in GET /admin/withdrawals:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Update withdrawal status (for finance/manual processing)
router.post('/admin/withdrawals/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, internalNote } = req.body || {};
  const allowed = ['PENDING', 'PROCESSING', 'SENT', 'SUCCESS', 'FAILED'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: 'Invalid status' });
  }
  try {
    const result = await pool.query(
      `
        UPDATE withdrawals
        SET status = $1,
            internal_note = COALESCE($2, internal_note),
            updated_at = now()
        WHERE id = $3
        RETURNING *
      `,
      [status, internalNote || null, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'Withdrawal not found' });
    }
    return res.json({ ok: true, withdrawal: result.rows[0] });
  } catch (err) {
    console.error('Error in POST /admin/withdrawals/:id/status:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
