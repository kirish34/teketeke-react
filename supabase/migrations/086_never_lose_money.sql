-- 086_never_lose_money.sql
-- Support "Never lose money" flow: tag payments with matatu/shift/trip, allow auto-open shifts/trips,
-- and enable assignment + confirmation metadata.

-- A) Payment source table (mpesa_c2b_payments powers /api/matatu/live-payments)
alter table if exists public.mpesa_c2b_payments
  add column if not exists matatu_id uuid null,
  add column if not exists shift_id uuid null,
  add column if not exists trip_id uuid null,
  add column if not exists confirmed_at timestamptz null,
  add column if not exists confirmed_by uuid null,
  add column if not exists confirmed_shift_id uuid null,
  add column if not exists assigned_at timestamptz null,
  add column if not exists assigned_by uuid null,
  add column if not exists auto_assigned boolean not null default false;

create index if not exists idx_payments_matatu_created_at on public.mpesa_c2b_payments(matatu_id, created_at desc);
create index if not exists idx_payments_shift_id on public.mpesa_c2b_payments(shift_id);
create index if not exists idx_payments_trip_id on public.mpesa_c2b_payments(trip_id);
create index if not exists idx_payments_confirmed_at on public.mpesa_c2b_payments(confirmed_at);

-- Best-effort backfill matatu_id from wallet aliases / matched wallet
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='wallet_aliases') then
    update public.mpesa_c2b_payments p
       set matatu_id = coalesce(p.matatu_id, w_alias.matatu_id, w_match.matatu_id)
      from wallet_aliases wa
      left join wallets w_alias on w_alias.id = wa.wallet_id
      left join wallets w_match on w_match.id = p.matched_wallet_id
     where wa.alias = p.account_reference
       and wa.is_active = true
       and p.matatu_id is null;
  end if;
exception when others then
  -- backfill is best-effort; ignore failures
  null;
end $$;

-- Optional parity for STK payments if table exists
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='mpesa_stk_payments') then
    alter table public.mpesa_stk_payments
      add column if not exists matatu_id uuid null,
      add column if not exists shift_id uuid null,
      add column if not exists trip_id uuid null,
      add column if not exists confirmed_at timestamptz null,
      add column if not exists confirmed_by uuid null,
      add column if not exists confirmed_shift_id uuid null,
      add column if not exists assigned_at timestamptz null,
      add column if not exists assigned_by uuid null,
      add column if not exists auto_assigned boolean not null default false;
    create index if not exists idx_payments_stk_matatu_created_at on public.mpesa_stk_payments(matatu_id, created_at desc);
    create index if not exists idx_payments_stk_shift_id on public.mpesa_stk_payments(shift_id);
    create index if not exists idx_payments_stk_trip_id on public.mpesa_stk_payments(trip_id);
    create index if not exists idx_payments_stk_confirmed_at on public.mpesa_stk_payments(confirmed_at);
  end if;
exception when others then
  null;
end $$;

-- B) matatu_shifts: add auto-open metadata and enforce one OPEN shift per matatu
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='matatu_shifts') then
    create table public.matatu_shifts (
      id uuid primary key default gen_random_uuid(),
      matatu_id uuid not null references public.matatus(id) on delete cascade,
      staff_user_id uuid null,
      opened_by_user_id uuid null,
      opened_by text not null default 'USER', -- USER / SYSTEM
      auto_opened boolean not null default false,
      opened_at timestamptz not null default now(),
      closed_at timestamptz null,
      status text not null default 'OPEN', -- OPEN / CLOSED
      opening_balance numeric not null default 0,
      closing_balance numeric not null default 0,
      total_collected numeric not null default 0,
      deposit_amount numeric not null default 0,
      created_at timestamptz default now()
    );
  end if;
exception when others then
  null;
end $$;

alter table if exists public.matatu_shifts
  add column if not exists opened_by_user_id uuid null,
  add column if not exists opened_by text not null default 'USER',
  add column if not exists auto_opened boolean not null default false;

-- Allow system-opened shifts without a staff user id
do $$
begin
  alter table public.matatu_shifts alter column staff_user_id drop not null;
exception when others then null;
end $$;

-- Backfill opened_by_user_id from staff_user_id where missing
update public.matatu_shifts
   set opened_by_user_id = coalesce(opened_by_user_id, staff_user_id),
       opened_by = coalesce(opened_by, 'USER')
 where opened_by_user_id is null and staff_user_id is not null;

-- Keep only the most recent OPEN shift per matatu before enforcing uniqueness
with ranked as (
  select id, matatu_id, opened_at,
         row_number() over (partition by matatu_id order by opened_at desc) as rn
    from public.matatu_shifts
   where status = 'OPEN'
)
update public.matatu_shifts
   set status = 'CLOSED',
       closed_at = coalesce(closed_at, now())
 where id in (select id from ranked where rn > 1);

create unique index if not exists uniq_open_shift_per_matatu
  on public.matatu_shifts(matatu_id)
  where status = 'OPEN';

-- C) matatu_trips: auto-start metadata + uniqueness
alter table if exists public.matatu_trips
  add column if not exists shift_id uuid null,
  add column if not exists started_by text not null default 'USER',
  add column if not exists auto_started boolean not null default false;

-- Deduplicate multiple IN_PROGRESS trips per matatu (keep latest in-progress)
with ranked as (
  select id, matatu_id, started_at,
         row_number() over (partition by matatu_id order by started_at desc, id desc) as rn
    from public.matatu_trips
   where status = 'IN_PROGRESS'
)
update public.matatu_trips
   set status = 'ENDED',
       ended_at = coalesce(ended_at, now())
 where id in (select id from ranked where rn > 1);

create unique index if not exists uniq_inprogress_trip_per_matatu
  on public.matatu_trips(matatu_id)
  where status = 'IN_PROGRESS';

-- D) Wallet ledger tagging (idempotent)
alter table if exists public.wallet_ledger
  add column if not exists shift_id uuid null,
  add column if not exists trip_id uuid null;

create index if not exists idx_wallet_ledger_shift_id on public.wallet_ledger(shift_id);
create index if not exists idx_wallet_ledger_trip_id on public.wallet_ledger(trip_id);

-- Optional FKs (best-effort)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='matatu_shifts') then
    alter table public.wallet_ledger
      add constraint wallet_ledger_shift_id_fkey2
      foreign key (shift_id) references public.matatu_shifts(id) on delete set null;
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='matatu_trips') then
    alter table public.wallet_ledger
      add constraint wallet_ledger_trip_id_fkey2
      foreign key (trip_id) references public.matatu_trips(id) on delete set null;
  end if;
exception when duplicate_object then null;
end $$;
