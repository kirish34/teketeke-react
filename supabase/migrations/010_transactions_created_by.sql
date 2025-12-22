-- 010_transactions_created_by.sql
-- Add audit columns to attribute collections to staff users

alter table public.transactions
  add column if not exists created_by uuid,
  add column if not exists created_by_email text,
  add column if not exists created_by_name text;

create index if not exists idx_tx_created_by on public.transactions(created_by);

