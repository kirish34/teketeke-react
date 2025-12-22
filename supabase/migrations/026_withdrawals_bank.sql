-- Extend withdrawals to support BANK (EFT/RTGS) alongside M_PESA
alter table withdrawals
  add column if not exists method text default 'M_PESA', -- 'M_PESA' or 'BANK'
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists bank_account_number text,
  add column if not exists bank_account_name text,
  add column if not exists internal_note text;
