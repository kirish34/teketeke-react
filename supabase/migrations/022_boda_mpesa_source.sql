-- 022_boda_mpesa_source.sql
-- Add source/metadata fields for Boda cash/expense entries (M-Pesa SMS imports)

alter table if exists public.boda_cash_entries
  add column if not exists source text,
  add column if not exists mpesa_ref text,
  add column if not exists meta jsonb;

alter table if exists public.boda_expense_entries
  add column if not exists source text,
  add column if not exists mpesa_ref text,
  add column if not exists meta jsonb;

create index if not exists idx_boda_cash_mpesa_ref on public.boda_cash_entries(mpesa_ref);
create index if not exists idx_boda_exp_mpesa_ref on public.boda_expense_entries(mpesa_ref);

