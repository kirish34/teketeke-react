const express = require('express');
const { requireUser } = require('../middleware/auth');
const router = express.Router();

// Summary for a given date (per-user)
router.get('/summary', requireUser, async (req, res) => {
  try{
    const dateStr = String(req.query.date || new Date().toISOString().slice(0,10));
    const start = new Date(dateStr + 'T00:00:00.000Z');
    const end = new Date(new Date(start).getTime() + 24*3600*1000);

    const [cashRes, expRes] = await Promise.all([
      req.supa.from('boda_cash_entries').select('amount,created_at').order('created_at',{ascending:false}),
      req.supa.from('boda_expense_entries').select('amount,created_at').order('created_at',{ascending:false}),
    ]);
    if (cashRes.error) return res.status(500).json({ error: cashRes.error.message });
    if (expRes.error) return res.status(500).json({ error: expRes.error.message });

    const cashToday = (cashRes.data||[]).filter(r=>{
      const t = new Date(r.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).reduce((a,b)=> a + Number(b.amount||0), 0);
    const expToday = (expRes.data||[]).filter(r=>{
      const t = new Date(r.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).reduce((a,b)=> a + Number(b.amount||0), 0);

    res.json({ summary: { till_today: 0, cash_today: cashToday, expenses_today: expToday }, date: dateStr });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// Insights over a date range (weekly/monthly overview, expense breakdown, trends)
router.get('/insights', requireUser, async (req, res) => {
  try{
    const todayStr = new Date().toISOString().slice(0,10);
    const startStr = String(req.query.start || '');
    const endStr = String(req.query.end || '');

    const startDate = startStr ? new Date(startStr + 'T00:00:00.000Z') : new Date(todayStr + 'T00:00:00.000Z');
    const endDateExclusive = endStr
      ? new Date(new Date(endStr + 'T00:00:00.000Z').getTime() + 24*3600*1000)
      : new Date(new Date(startDate).getTime() + 7*24*3600*1000);

    const maxSpanMs = 90 * 24 * 3600 * 1000;
    if (endDateExclusive.getTime() - startDate.getTime() > maxSpanMs){
      return res.status(400).json({ error: 'Range too large (max 90 days)' });
    }

    const [cashRes, expRes] = await Promise.all([
      req.supa.from('boda_cash_entries')
        .select('amount,created_at')
        .gte('created_at', startDate.toISOString())
        .lt('created_at', endDateExclusive.toISOString())
        .order('created_at',{ascending:true}),
      req.supa.from('boda_expense_entries')
        .select('amount,created_at,category')
        .gte('created_at', startDate.toISOString())
        .lt('created_at', endDateExclusive.toISOString())
        .order('created_at',{ascending:true}),
    ]);
    if (cashRes.error) return res.status(500).json({ error: cashRes.error.message });
    if (expRes.error) return res.status(500).json({ error: expRes.error.message });

    const cashRows = cashRes.data || [];
    const expRows = expRes.data || [];

    const totalIncome = cashRows.reduce((sum, r)=> sum + Number(r.amount||0), 0);
    const totalExpenses = expRows.reduce((sum, r)=> sum + Number(r.amount||0), 0);
    const net = totalIncome - totalExpenses;

    // Daily trend
    const days = {};
    const dayKey = (ts)=> new Date(ts).toISOString().slice(0,10);
    cashRows.forEach(r=>{
      const k = dayKey(r.created_at);
      if (!days[k]) days[k] = { date: k, income: 0, expenses: 0 };
      days[k].income += Number(r.amount||0);
    });
    expRows.forEach(r=>{
      const k = dayKey(r.created_at);
      if (!days[k]) days[k] = { date: k, income: 0, expenses: 0 };
      days[k].expenses += Number(r.amount||0);
    });
    const trend = Object.values(days)
      .sort((a,b)=> a.date.localeCompare(b.date))
      .map(row => ({ ...row, net: row.income - row.expenses }));

    const dayCount = trend.length || Math.max(1, Math.round((endDateExclusive.getTime() - startDate.getTime())/(24*3600*1000)));
    const avgNetPerDay = dayCount ? net / dayCount : 0;

    // Expense breakdown by category
    const byCategory = {};
    expRows.forEach(r=>{
      const cat = (r.category || 'Other').toString();
      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat] += Number(r.amount||0);
    });
    const expenseCategories = Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a,b)=> b.amount - a.amount);

    const topCategory = expenseCategories[0] || null;
    const expensePctOfIncome = totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : null;

    res.json({
      range: {
        start: startDate.toISOString().slice(0,10),
        end: new Date(endDateExclusive.getTime() - 24*3600*1000).toISOString().slice(0,10)
      },
      totals: {
        income: totalIncome,
        expenses: totalExpenses,
        net,
        avg_net_per_day: avgNetPerDay,
        expense_pct_of_income: expensePctOfIncome
      },
      expenses: {
        categories: expenseCategories,
        top_category: topCategory
      },
      trend
    });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

// Recent cash entries (optional date range)
router.get('/cash', requireUser, async (req, res) => {
  try{
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
    const startStr = req.query.start ? String(req.query.start) : null;
    const endStr = req.query.end ? String(req.query.end) : null;

    let query = req.supa
      .from('boda_cash_entries')
      .select('id,created_at,amount,payer_name,phone,notes')
      .order('created_at', { ascending:false });

    if (startStr){
      const startDate = new Date(startStr + 'T00:00:00.000Z');
      query = query.gte('created_at', startDate.toISOString());
    }
    if (endStr){
      const endDate = new Date(endStr + 'T00:00:00.000Z');
      const endExclusive = new Date(endDate.getTime() + 24*3600*1000);
      query = query.lt('created_at', endExclusive.toISOString());
    }

    const { data, error } = await query.limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data||[], limit });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// Record a cash entry
router.post('/cash', requireUser, async (req, res) => {
  try{
    const { amount, payer_name = '', phone = '', notes = '' } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount required' });
    const row = { user_id: req.user.id, amount: Number(amount), payer_name, phone, notes };
    const { data, error } = await req.supa.from('boda_cash_entries').insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// Recent expense entries
router.get('/expenses', requireUser, async (req, res) => {
  try{
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 20)));
    const { data, error } = await req.supa
      .from('boda_expense_entries')
      .select('id,created_at,category,amount,notes')
      .order('created_at', { ascending:false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data||[], limit });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// Record an expense
router.post('/expenses', requireUser, async (req, res) => {
  try{
    const { category = 'Other', amount, notes = '' } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount required' });
    const row = { user_id: req.user.id, category: String(category||'Other'), amount: Number(amount), notes };
    const { data, error } = await req.supa.from('boda_expense_entries').insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// Finance settings (monthly savings target)
router.get('/settings', requireUser, async (req, res) => {
  try{
    const { data, error } = await req.supa
      .from('boda_finance_settings')
      .select('user_id,monthly_savings_target_kes')
      .eq('user_id', req.user.id)
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    const row = (data && data[0]) || null;
    res.json({ monthly_savings_target_kes: Number(row?.monthly_savings_target_kes || 0) });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

router.post('/settings', requireUser, async (req, res) => {
  try{
    const targetRaw = req.body?.monthly_savings_target_kes;
    const target = Math.max(0, Number(targetRaw || 0));
    const row = {
      user_id: req.user.id,
      monthly_savings_target_kes: target,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await req.supa
      .from('boda_finance_settings')
      .upsert(row, { onConflict: 'user_id' })
      .select('user_id,monthly_savings_target_kes')
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    const out = (data && data[0]) || row;
    res.json({ monthly_savings_target_kes: Number(out.monthly_savings_target_kes || 0) });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

// Import parsed M-Pesa SMS entries (from Android plugin)
router.post('/mpesa-import', requireUser, async (req, res) => {
  try{
    const payload = req.body || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length){
      return res.status(400).json({ error: 'items array required' });
    }
    const userId = req.user.id;

    const normalized = items.map((raw)=>{
      const kind = String(raw.kind || '').toUpperCase();
      const amount = Number(raw.amount || 0);
      const category = (raw.category || '').toString();
      const mpesaRef = (raw.mpesa_ref || raw.reference || '').toString().trim() || null;
      const occurredAt = raw.occurred_at || raw.time || raw.timestamp || null;
      const counterparty = (raw.counterparty || raw.party || '').toString();
      const description = (raw.description || raw.note || '').toString();
      return { kind, amount, category, mpesaRef, occurredAt, counterparty, description, raw };
    }).filter(it => it.amount > 0 && (it.kind === 'IN' || it.kind === 'OUT'));

    if (!normalized.length){
      return res.status(400).json({ error: 'no valid items (kind IN/OUT with amount > 0) supplied' });
    }

    // Deduplicate by mpesa_ref if provided
    const refs = Array.from(new Set(normalized.map(i => i.mpesaRef).filter(Boolean)));
    const existingRefs = new Set();
    if (refs.length){
      const [cashExisting, expExisting] = await Promise.all([
        req.supa
          .from('boda_cash_entries')
          .select('mpesa_ref')
          .eq('user_id', userId)
          .in('mpesa_ref', refs),
        req.supa
          .from('boda_expense_entries')
          .select('mpesa_ref')
          .eq('user_id', userId)
          .in('mpesa_ref', refs),
      ]);
      if (cashExisting.error) return res.status(500).json({ error: cashExisting.error.message });
      if (expExisting.error) return res.status(500).json({ error: expExisting.error.message });
      (cashExisting.data || []).forEach(r => { if (r.mpesa_ref) existingRefs.add(r.mpesa_ref); });
      (expExisting.data || []).forEach(r => { if (r.mpesa_ref) existingRefs.add(r.mpesa_ref); });
    }

    const cashRows = [];
    const expRows = [];
    let skippedDuplicates = 0;

    normalized.forEach(item => {
      if (item.mpesaRef && existingRefs.has(item.mpesaRef)){
        skippedDuplicates += 1;
        return;
      }
      const created_at = item.occurredAt ? new Date(item.occurredAt).toISOString() : new Date().toISOString();
      const meta = { counterparty: item.counterparty || null };
      if (item.mpesaRef) meta.mpesa_ref = item.mpesaRef;

      if (item.kind === 'IN'){
        cashRows.push({
          user_id: userId,
          amount: item.amount,
          payer_name: item.counterparty || 'M-Pesa',
          phone: null,
          notes: item.description || 'M-Pesa auto-import',
          created_at,
          source: 'MPESA_SMS',
          mpesa_ref: item.mpesaRef,
          meta,
        });
      } else if (item.kind === 'OUT'){
        const cat = item.category || 'Other';
        expRows.push({
          user_id: userId,
          category: String(cat || 'Other'),
          amount: item.amount,
          notes: item.description || (item.counterparty ? `M-Pesa to ${item.counterparty}` : 'M-Pesa auto-import'),
          created_at,
          source: 'MPESA_SMS',
          mpesa_ref: item.mpesaRef,
          meta,
        });
      }
    });

    let insertedCash = 0;
    let insertedExp = 0;

    if (cashRows.length){
      const { data, error } = await req.supa
        .from('boda_cash_entries')
        .insert(cashRows)
        .select('id');
      if (error) return res.status(500).json({ error: error.message });
      insertedCash = (data || []).length;
    }

    if (expRows.length){
      const { data, error } = await req.supa
        .from('boda_expense_entries')
        .insert(expRows)
        .select('id');
      if (error) return res.status(500).json({ error: error.message });
      insertedExp = (data || []).length;
    }

    res.json({
      inserted_cash: insertedCash,
      inserted_expenses: insertedExp,
      skipped_duplicates: skippedDuplicates,
      received: items.length,
    });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
