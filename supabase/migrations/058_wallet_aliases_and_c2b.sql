-- 058_wallet_aliases_and_c2b.sql
-- Wallet aliases + C2B quarantine + C2B payments alignment

-- 1) Wallet aliases (many aliases -> one wallet)
create table if not exists public.wallet_aliases (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  alias text not null,
  alias_type text not null check (alias_type in ('PAYBILL_CODE','PLATE')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(alias)
);
create index if not exists wallet_aliases_wallet_idx on public.wallet_aliases(wallet_id);
create index if not exists wallet_aliases_type_idx on public.wallet_aliases(alias_type);

-- 2) Quarantine table for suspicious callbacks
create table if not exists public.mpesa_c2b_quarantine (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  paybill_number text,
  account_reference text,
  amount numeric,
  msisdn text,
  raw jsonb not null,
  reason text not null
);

-- 3) Align mpesa_c2b_payments with new schema requirements
alter table if exists public.mpesa_c2b_payments
  add column if not exists paybill_number text,
  add column if not exists account_reference text,
  add column if not exists receipt text,
  add column if not exists checkout_request_id text,
  add column if not exists status text not null default 'RECEIVED',
  add column if not exists raw jsonb not null default '{}'::jsonb,
  add column if not exists msisdn text,
  add column if not exists amount numeric;

do $$ begin
  alter table public.mpesa_c2b_payments
    add constraint mpesa_c2b_payments_status_check
    check (status in ('RECEIVED','CREDITED','REJECTED','QUARANTINED'));
exception when duplicate_object then null; end $$;

create index if not exists c2b_account_reference_idx on public.mpesa_c2b_payments(account_reference);
create index if not exists c2b_receipt_idx on public.mpesa_c2b_payments(receipt);
create index if not exists c2b_checkout_request_idx on public.mpesa_c2b_payments(checkout_request_id);
create index if not exists c2b_status2_idx on public.mpesa_c2b_payments(status);

-- 4) RLS: block client access
alter table public.wallet_aliases enable row level security;
alter table public.mpesa_c2b_quarantine enable row level security;

drop policy if exists "wallet_aliases_no_client_access" on public.wallet_aliases;
create policy "wallet_aliases_no_client_access"
on public.wallet_aliases
for all
to authenticated
using (false)
with check (false);

drop policy if exists "c2b_quarantine_no_client_access" on public.mpesa_c2b_quarantine;
create policy "c2b_quarantine_no_client_access"
on public.mpesa_c2b_quarantine
for all
to authenticated
using (false)
with check (false);
