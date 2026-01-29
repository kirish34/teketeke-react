-- 084_matatu_shifts.sql
-- Shift support for matatu staff and tagging wallet ledger entries.

create table if not exists public.matatu_shifts (
  id uuid primary key default gen_random_uuid(),
  matatu_id uuid not null,
  staff_user_id uuid not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,
  status text not null default 'OPEN',
  opening_balance numeric not null default 0,
  closing_balance numeric not null default 0,
  total_collected numeric not null default 0,
  deposit_amount numeric not null default 0,
  created_at timestamptz default now()
);

-- One open shift per matatu+staff enforced in application logic.
create index if not exists idx_matatu_shifts_matatu_status on public.matatu_shifts(matatu_id, status, opened_at desc);
create index if not exists idx_matatu_shifts_staff_status on public.matatu_shifts(staff_user_id, status, opened_at desc);

alter table if exists public.wallet_ledger
  add column if not exists shift_id uuid null;

create index if not exists idx_wallet_ledger_shift_id on public.wallet_ledger(shift_id);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'matatu_shifts') then
    alter table public.wallet_ledger
      add constraint wallet_ledger_shift_id_fkey
      foreign key (shift_id) references public.matatu_shifts(id) on delete set null;
  end if;
exception when duplicate_object then
  null;
end $$;

create table if not exists public.matatu_auto_rules (
  matatu_id uuid primary key,
  savings_amount_daily numeric default 0,
  loan_amount_daily numeric default 0,
  sacco_fee_amount_daily numeric default 0,
  priority_order text default 'SACCO_FEE,LOAN,SAVINGS',
  updated_at timestamptz default now()
);

create table if not exists public.wallet_destinations (
  id uuid primary key default gen_random_uuid(),
  matatu_id uuid not null,
  type text not null, -- MPESA_NUMBER/PAYBILL/BANK/TILL
  value text not null,
  is_default_disbursement boolean default true,
  created_at timestamptz default now()
);

-- Shift tagging on mpesa intake tables
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mpesa_c2b_payments') then
    alter table public.mpesa_c2b_payments add column if not exists trip_id uuid null;
    alter table public.mpesa_c2b_payments add column if not exists shift_id uuid null;
    create index if not exists idx_mpesa_c2b_trip on public.mpesa_c2b_payments(trip_id);
    create index if not exists idx_mpesa_c2b_shift on public.mpesa_c2b_payments(shift_id);
  end if;
exception when others then
  null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mpesa_stk_payments') then
    alter table public.mpesa_stk_payments add column if not exists trip_id uuid null;
    alter table public.mpesa_stk_payments add column if not exists shift_id uuid null;
    create index if not exists idx_mpesa_stk_trip on public.mpesa_stk_payments(trip_id);
    create index if not exists idx_mpesa_stk_shift on public.mpesa_stk_payments(shift_id);
  end if;
exception when others then
  null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mpesa_stk_requests') then
    alter table public.mpesa_stk_requests add column if not exists trip_id uuid null;
    alter table public.mpesa_stk_requests add column if not exists shift_id uuid null;
    create index if not exists idx_mpesa_stk_requests_trip on public.mpesa_stk_requests(trip_id);
    create index if not exists idx_mpesa_stk_requests_shift on public.mpesa_stk_requests(shift_id);
  end if;
exception when others then
  null;
end $$;
