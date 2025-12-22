-- 005_transactions_idempotency.sql
-- Add idempotency columns for Daraja callback reconciliation

alter table public.transactions
  add column if not exists external_id text,
  add column if not exists checkout_request_id text;

create unique index if not exists ux_transactions_external_id
  on public.transactions(external_id) where external_id is not null;

