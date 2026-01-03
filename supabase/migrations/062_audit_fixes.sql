-- 062_audit_fixes.sql
-- Audit hardening: ensure tables/constraints exist and are idempotent

-- 1) Wallet aliases table (idempotent)
create table if not exists public.wallet_aliases (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  alias text not null,
  alias_type text not null check (alias_type in ('PAYBILL_CODE','PLATE')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table if exists public.wallet_aliases
  add column if not exists wallet_id uuid,
  add column if not exists alias text,
  add column if not exists alias_type text,
  add column if not exists is_active boolean,
  add column if not exists created_at timestamptz;

alter table if exists public.wallet_aliases
  alter column is_active set default true,
  alter column created_at set default now();

do $$ begin
  alter table public.wallet_aliases
    add constraint wallet_aliases_alias_key unique (alias);
exception when duplicate_object or duplicate_table then null; end $$;

do $$ begin
  alter table public.wallet_aliases
    add constraint wallet_aliases_alias_type_check
    check (alias_type in ('PAYBILL_CODE','PLATE'));
exception when duplicate_object or duplicate_table then null; end $$;

create index if not exists wallet_aliases_wallet_idx on public.wallet_aliases(wallet_id);
create index if not exists wallet_aliases_type_idx on public.wallet_aliases(alias_type);

alter table public.wallet_aliases enable row level security;
drop policy if exists "wallet_aliases_no_client_access" on public.wallet_aliases;
create policy "wallet_aliases_no_client_access"
on public.wallet_aliases
for all
to authenticated
using (false)
with check (false);

-- 2) C2B quarantine table (idempotent)
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

alter table if exists public.mpesa_c2b_quarantine
  add column if not exists received_at timestamptz,
  add column if not exists paybill_number text,
  add column if not exists account_reference text,
  add column if not exists amount numeric,
  add column if not exists msisdn text,
  add column if not exists raw jsonb,
  add column if not exists reason text;

alter table public.mpesa_c2b_quarantine enable row level security;
drop policy if exists "c2b_quarantine_no_client_access" on public.mpesa_c2b_quarantine;
create policy "c2b_quarantine_no_client_access"
on public.mpesa_c2b_quarantine
for all
to authenticated
using (false)
with check (false);

-- 3) mpesa_c2b_payments status constraint + defaults
do $$ begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'mpesa_c2b_payments') then
    update public.mpesa_c2b_payments set status = 'RECEIVED' where status is null;
    alter table public.mpesa_c2b_payments alter column status set default 'RECEIVED';
    alter table public.mpesa_c2b_payments alter column status set not null;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'mpesa_c2b_payments') then
    alter table public.mpesa_c2b_payments
      add constraint mpesa_c2b_payments_status_check
      check (status in ('RECEIVED','CREDITED','QUARANTINED','REJECTED'));
  end if;
exception when duplicate_object or duplicate_table then null; end $$;
