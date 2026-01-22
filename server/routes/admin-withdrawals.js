const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireSystemOrSuper } = require('../middleware/requireAdmin');
const { logAdminAction } = require('../services/audit.service');

router.use(requireSystemOrSuper);

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
async function updateWithdrawalStatus(req, res) {
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
    await logAdminAction({
      req,
      action: 'withdrawal_update_status',
      resource_type: 'withdrawal',
      resource_id: id,
      payload: { status, note: internalNote || null },
    });
    return res.json({ ok: true, withdrawal: result.rows[0] });
  } catch (err) {
    console.error('Error in POST /admin/withdrawals/:id/status:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

router.post('/admin/withdrawals/:id/status', updateWithdrawalStatus);
router.post('/withdrawals/:id/status', updateWithdrawalStatus);

module.exports = router;
