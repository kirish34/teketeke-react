-- 003_boda_taxi.sql
-- BodaBoda and Taxi simple bookkeeping tables for dashboards

-- Tables: per-user scoped via RLS (user_id = auth.uid())

create table if not exists public.taxi_cash_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric not null check (amount > 0),
  name text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.taxi_expense_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null,
  amount numeric not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_taxi_cash_user_created on public.taxi_cash_entries(user_id, created_at desc);
create index if not exists idx_taxi_exp_user_created on public.taxi_expense_entries(user_id, created_at desc);

alter table public.taxi_cash_entries enable row level security;
alter table public.taxi_expense_entries enable row level security;

create policy "taxi_cash select own" on public.taxi_cash_entries for select using ( user_id = auth.uid() );
create policy "taxi_cash insert own" on public.taxi_cash_entries for insert with check ( user_id = auth.uid() );
create policy "taxi_expense select own" on public.taxi_expense_entries for select using ( user_id = auth.uid() );
create policy "taxi_expense insert own" on public.taxi_expense_entries for insert with check ( user_id = auth.uid() );

-- BodaBoda
create table if not exists public.boda_cash_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric not null check (amount > 0),
  payer_name text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.boda_expense_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null,
  amount numeric not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_boda_cash_user_created on public.boda_cash_entries(user_id, created_at desc);
create index if not exists idx_boda_exp_user_created on public.boda_expense_entries(user_id, created_at desc);

alter table public.boda_cash_entries enable row level security;
alter table public.boda_expense_entries enable row level security;

create policy "boda_cash select own" on public.boda_cash_entries for select using ( user_id = auth.uid() );
create policy "boda_cash insert own" on public.boda_cash_entries for insert with check ( user_id = auth.uid() );
create policy "boda_expense select own" on public.boda_expense_entries for select using ( user_id = auth.uid() );
create policy "boda_expense insert own" on public.boda_expense_entries for insert with check ( user_id = auth.uid() );

