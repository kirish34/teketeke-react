const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { requireSuperOnly } = require('../middleware/requireAdmin');
const { logAdminAction } = require('../services/audit.service');

router.use(requireSuperOnly);

async function updatePayout(req, table, id, body, res) {
  try {
    const update = {
      payout_phone: body?.payout_phone || null,
      payout_method: body?.payout_method || null,
      payout_bank_name: body?.payout_bank_name || null,
      payout_bank_branch: body?.payout_bank_branch || null,
      payout_bank_account_number: body?.payout_bank_account_number || null,
      payout_bank_account_name: body?.payout_bank_account_name || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    await logAdminAction({
      req,
      action: `${table}_payout_update`,
      resource_type: table,
      resource_id: id,
      payload: { payout_method: update.payout_method, payout_phone: update.payout_phone },
    });
    return res.json({ ok: true, payout: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to update payout' });
  }
}

router.post('/taxis/:id/payout', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'taxi id required' });
  return updatePayout(req, 'taxis', id, req.body, res);
});

router.post('/bodabodas/:id/payout', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'boda id required' });
  return updatePayout(req, 'bodabodas', id, req.body, res);
});

module.exports = router;
