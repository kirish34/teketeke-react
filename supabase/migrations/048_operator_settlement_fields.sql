-- Add operator contact account and settlement bank fields
alter table if exists public.saccos
  add column if not exists contact_account_number text,
  add column if not exists settlement_bank_name text,
  add column if not exists settlement_bank_account_number text;
