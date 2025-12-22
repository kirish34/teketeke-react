const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { requireAdminAccess } = require('../middleware/admin-access');

router.use(requireAdminAccess);

async function updatePayout(table, id, body, res) {
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
    return res.json({ ok: true, payout: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to update payout' });
  }
}

router.post('/taxis/:id/payout', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'taxi id required' });
  return updatePayout('taxis', id, req.body, res);
});

router.post('/bodabodas/:id/payout', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'boda id required' });
  return updatePayout('bodabodas', id, req.body, res);
});

module.exports = router;
