-- Wallets schema for TekeTeke
-- ENUMS
do $$ begin
  create type wallet_type as enum ('matatu','owner','sacco','clearing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_role as enum ('owner','staff','sacco_admin','super_admin','auditor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ledger_kind as enum ('c2b_in','internal_transfer','fee','loan_repay','loan_disburse','savings','correction','adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payout_status as enum ('pending','approved','rejected','processing','paid','failed','cancelled');
exception when duplicate_object then null; end $$;

-- HELPERS
create extension if not exists pgcrypto;

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Backfill domain column when tables already exist (older schema without domain)
alter table if exists public.wallets add column if not exists domain text not null default 'teketeke';
alter table if exists public.wallet_links add column if not exists domain text not null default 'teketeke';
alter table if exists public.wallet_members add column if not exists domain text not null default 'teketeke';
alter table if exists public.withdrawal_authorizations add column if not exists domain text not null default 'teketeke';
alter table if exists public.automation_rules add column if not exists domain text not null default 'teketeke';
alter table if exists public.ledger_entries add column if not exists domain text not null default 'teketeke';
alter table if exists public.external_payout_requests add column if not exists domain text not null default 'teketeke';
alter table if exists public.mpesa_c2b_payments add column if not exists domain text not null default 'teketeke';
alter table if exists public.unmatched_payments add column if not exists domain text not null default 'teketeke';

-- Align legacy wallets table (from earlier migrations) with the new schema so later indexes/policies succeed.
alter table if exists public.wallets add column if not exists wallet_type wallet_type;
alter table if exists public.wallets add column if not exists wallet_code text;
alter table if exists public.wallets add column if not exists product_code smallint;
alter table if exists public.wallets add column if not exists sacco_id uuid;
alter table if exists public.wallets add column if not exists matatu_id uuid;
alter table if exists public.wallets add column if not exists owner_id uuid;
alter table if exists public.wallets add column if not exists label text;
alter table if exists public.wallets add column if not exists is_active boolean;

-- Populate newly added wallet columns where possible
update public.wallets
set wallet_type = case upper(coalesce(entity_type, ''))
  when 'MATATU' then 'matatu'::wallet_type
  when 'SACCO' then 'sacco'::wallet_type
  when 'OWNER' then 'owner'::wallet_type
  else 'clearing'::wallet_type
end
where wallet_type is null;

update public.wallets
set wallet_code = coalesce(wallet_code, virtual_account_code, 'W-' || substr(id::text, 1, 8))
where wallet_code is null;

update public.wallets
set product_code = coalesce(product_code, 2)
where product_code is null;

update public.wallets
set is_active = coalesce(is_active, true)
where is_active is null;

-- Enforce not-null/defaults after backfill
alter table if exists public.wallets alter column wallet_type set not null;
alter table if exists public.wallets alter column wallet_code set not null;
alter table if exists public.wallets alter column product_code set not null;
alter table if exists public.wallets alter column product_code set default 2;
alter table if exists public.wallets alter column is_active set not null;
alter table if exists public.wallets alter column is_active set default true;

do $$ begin
  alter table public.wallets add constraint wallets_wallet_code_key unique (wallet_code);
exception when duplicate_object then null; end $$;

-- 1) WALLETS
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  wallet_type wallet_type not null,
  wallet_code text not null unique,
  product_code smallint not null default 2,
  sacco_id uuid null,
  matatu_id uuid null,
  owner_id uuid null,
  label text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wallets_domain_idx on public.wallets(domain);
create index if not exists wallets_type_idx on public.wallets(wallet_type);
create index if not exists wallets_sacco_idx on public.wallets(sacco_id);
create index if not exists wallets_matatu_idx on public.wallets(matatu_id);
drop trigger if exists wallets_set_updated_at on public.wallets;
create trigger wallets_set_updated_at before update on public.wallets for each row execute function public.set_updated_at();

-- 2) WALLET LINKS
create table if not exists public.wallet_links (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  from_wallet_id uuid not null references public.wallets(id) on delete cascade,
  to_wallet_id uuid not null references public.wallets(id) on delete cascade,
  link_type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists wallet_links_from_idx on public.wallet_links(from_wallet_id);
create index if not exists wallet_links_to_idx on public.wallet_links(to_wallet_id);

-- 3) WALLET MEMBERS
create table if not exists public.wallet_members (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null,
  role member_role not null,
  can_spend boolean not null default false,
  can_view boolean not null default true,
  created_at timestamptz not null default now(),
  unique(wallet_id, user_id)
);
create index if not exists wallet_members_wallet_idx on public.wallet_members(wallet_id);
create index if not exists wallet_members_user_idx on public.wallet_members(user_id);

-- 4) WITHDRAWAL AUTHORIZATIONS
create table if not exists public.withdrawal_authorizations (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  matatu_wallet_id uuid not null references public.wallets(id) on delete cascade,
  approved_phone text not null,
  approved_name text null,
  is_active boolean not null default true,
  max_per_tx numeric(12,2) null,
  max_per_day numeric(12,2) null,
  approved_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(matatu_wallet_id, approved_phone)
);
create index if not exists withdrawal_auth_wallet_idx on public.withdrawal_authorizations(matatu_wallet_id);
drop trigger if exists withdrawal_auth_set_updated_at on public.withdrawal_authorizations;
create trigger withdrawal_auth_set_updated_at before update on public.withdrawal_authorizations for each row execute function public.set_updated_at();

-- 5) AUTOMATION RULES
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  source_wallet_id uuid not null references public.wallets(id) on delete cascade,
  target_wallet_id uuid not null references public.wallets(id) on delete cascade,
  rule_kind ledger_kind not null,
  amount_type text not null default 'fixed',
  amount_value numeric(12,2) not null,
  schedule text not null default 'daily',
  run_time time not null default '18:00',
  timezone text not null default 'Africa/Nairobi',
  priority int not null default 100,
  is_active boolean not null default true,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists automation_rules_source_idx on public.automation_rules(source_wallet_id);
create index if not exists automation_rules_active_idx on public.automation_rules(is_active);

-- 6) LEDGER ENTRIES
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  kind ledger_kind not null,
  from_wallet_id uuid null references public.wallets(id) on delete set null,
  to_wallet_id uuid null references public.wallets(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'KES',
  reference text null,
  narrative text null,
  created_by_user_id uuid null,
  created_at timestamptz not null default now()
);
create index if not exists ledger_from_idx on public.ledger_entries(from_wallet_id);
create index if not exists ledger_to_idx on public.ledger_entries(to_wallet_id);
create index if not exists ledger_created_at_idx on public.ledger_entries(created_at);

-- 7) EXTERNAL PAYOUT REQUESTS
create table if not exists public.external_payout_requests (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  requested_by_user_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'KES',
  destination_phone text null,
  destination_bank text null,
  destination_account text null,
  status payout_status not null default 'pending',
  reason_code text null,
  approved_by_user_id uuid null,
  approved_at timestamptz null,
  provider_reference text null,
  failure_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payout_wallet_idx on public.external_payout_requests(wallet_id);
create index if not exists payout_status_idx on public.external_payout_requests(status);
drop trigger if exists payout_set_updated_at on public.external_payout_requests;
create trigger payout_set_updated_at before update on public.external_payout_requests for each row execute function public.set_updated_at();

-- 8) M-PESA C2B PAYMENTS (raw)
create table if not exists public.mpesa_c2b_payments (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  mpesa_receipt text not null,
  amount numeric(12,2) not null,
  msisdn text not null,
  paybill text not null,
  account_number text not null,
  trans_time timestamptz not null,
  matched_wallet_id uuid null references public.wallets(id) on delete set null,
  match_status text not null default 'unmatched',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(mpesa_receipt)
);
create index if not exists c2b_account_idx on public.mpesa_c2b_payments(account_number);
create index if not exists c2b_matched_idx on public.mpesa_c2b_payments(matched_wallet_id);
create index if not exists c2b_status_idx on public.mpesa_c2b_payments(match_status);

-- 9) UNMATCHED PAYMENTS
create table if not exists public.unmatched_payments (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  c2b_payment_id uuid not null references public.mpesa_c2b_payments(id) on delete cascade,
  reason text not null,
  resolved boolean not null default false,
  resolved_by_user_id uuid null,
  resolved_at timestamptz null,
  resolution_note text null,
  created_at timestamptz not null default now()
);
create index if not exists unmatched_resolved_idx on public.unmatched_payments(resolved);
