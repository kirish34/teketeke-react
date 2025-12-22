-- 016_daily_fee_rates.sql
-- Per-SACCO daily fee rates by vehicle type

create table if not exists public.daily_fee_rates (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  vehicle_type text not null,
  daily_fee_kes numeric not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_daily_fee_rates_sacco_type
  on public.daily_fee_rates(sacco_id, vehicle_type);

