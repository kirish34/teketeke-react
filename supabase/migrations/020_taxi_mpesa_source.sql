-- 020_taxi_mpesa_source.sql
-- Add source/metadata fields for Taxi cash/expense entries (M-Pesa SMS imports)

alter table if exists public.taxi_cash_entries
  add column if not exists source text,
  add column if not exists mpesa_ref text,
  add column if not exists meta jsonb;

alter table if exists public.taxi_expense_entries
  add column if not exists source text,
  add column if not exists mpesa_ref text,
  add column if not exists meta jsonb;

create index if not exists idx_taxi_cash_mpesa_ref on public.taxi_cash_entries(mpesa_ref);
create index if not exists idx_taxi_exp_mpesa_ref on public.taxi_expense_entries(mpesa_ref);

