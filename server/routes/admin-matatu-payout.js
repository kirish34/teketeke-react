const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { requireAdminAccess } = require('../middleware/admin-access');

// fallback guard: admin token or Supabase auth
router.use(requireAdminAccess);

router.post('/matatus/:id/payout', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'matatu id required' });
  try {
    const update = {
      payout_phone: req.body?.payout_phone || null,
      payout_method: req.body?.payout_method || null,
      payout_bank_name: req.body?.payout_bank_name || null,
      payout_bank_branch: req.body?.payout_bank_branch || null,
      payout_bank_account_number: req.body?.payout_bank_account_number || null,
      payout_bank_account_name: req.body?.payout_bank_account_name || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('matatus')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, matatu: data });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to update payout' });
  }
});

module.exports = router;
