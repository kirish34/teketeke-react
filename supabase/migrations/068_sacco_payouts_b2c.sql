-- 068_sacco_payouts_b2c.sql
-- Align SACCO payout schema for B2C-only payouts (MSISDN automated, PayBill/Till blocked).

create unique index if not exists payout_destinations_unique_ref_idx
  on public.payout_destinations(entity_type, entity_id, destination_type, destination_ref);

alter table if exists public.payout_items
  add column if not exists block_reason text;

alter table if exists public.payout_items
  add column if not exists provider_conversation_id text;

do $$ begin
  alter table public.payout_items drop constraint if exists payout_items_wallet_kind_chk;
exception when undefined_object then null; end $$;

update public.payout_items
set wallet_kind = case
  when wallet_kind in ('FEE','SACCO_DAILY_FEE') then 'SACCO_FEE'
  when wallet_kind in ('LOAN','SACCO_LOAN') then 'SACCO_LOAN'
  when wallet_kind in ('SAVINGS','SACCO_SAVINGS') then 'SACCO_SAVINGS'
  else wallet_kind
end
where wallet_kind in ('FEE','SACCO_DAILY_FEE','LOAN','SACCO_LOAN','SAVINGS','SACCO_SAVINGS');

do $$ begin
  alter table public.payout_items
    add constraint payout_items_wallet_kind_chk
    check (wallet_kind in ('SACCO_FEE','SACCO_LOAN','SACCO_SAVINGS'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.payout_items drop constraint if exists payout_items_status_chk;
exception when undefined_object then null; end $$;

do $$ begin
  alter table public.payout_items
    add constraint payout_items_status_chk
    check (status in ('PENDING','BLOCKED','SENT','CONFIRMED','FAILED','CANCELLED'));
exception when duplicate_object then null; end $$;
