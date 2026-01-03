-- 060_c2b_payments_compat.sql
-- Relax legacy columns + backfill new columns on mpesa_c2b_payments

alter table if exists public.mpesa_c2b_payments
  add column if not exists paybill_number text,
  add column if not exists account_reference text,
  add column if not exists receipt text,
  add column if not exists checkout_request_id text,
  add column if not exists status text not null default 'RECEIVED',
  add column if not exists raw jsonb not null default '{}'::jsonb,
  add column if not exists msisdn text,
  add column if not exists amount numeric;

alter table if exists public.mpesa_c2b_payments
  alter column mpesa_receipt drop not null,
  alter column paybill drop not null,
  alter column account_number drop not null,
  alter column trans_time drop not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mpesa_c2b_payments'
      and column_name = 'mpesa_receipt'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mpesa_c2b_payments'
      and column_name = 'receipt'
  ) then
    execute 'update public.mpesa_c2b_payments set receipt = coalesce(receipt, mpesa_receipt) where receipt is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mpesa_c2b_payments'
      and column_name = 'paybill'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mpesa_c2b_payments'
      and column_name = 'paybill_number'
  ) then
    execute 'update public.mpesa_c2b_payments set paybill_number = coalesce(paybill_number, paybill) where paybill_number is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mpesa_c2b_payments'
      and column_name = 'account_number'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mpesa_c2b_payments'
      and column_name = 'account_reference'
  ) then
    execute 'update public.mpesa_c2b_payments set account_reference = coalesce(account_reference, account_number) where account_reference is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mpesa_c2b_payments'
      and column_name = 'raw_payload'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mpesa_c2b_payments'
      and column_name = 'raw'
  ) then
    execute 'update public.mpesa_c2b_payments set raw = case when raw_payload is not null and (raw is null or raw = ''{}''::jsonb) then raw_payload else raw end where raw is null or raw = ''{}''::jsonb';
  end if;
end $$;
