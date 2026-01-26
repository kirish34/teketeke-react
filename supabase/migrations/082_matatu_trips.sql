-- 082_matatu_trips.sql
-- Track matatu staff trips with start/end timestamps and aggregates.

create table if not exists public.matatu_trips (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  matatu_id uuid not null references public.matatus(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  status text not null default 'IN_PROGRESS',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by_user_id uuid,
  ended_by_user_id uuid,
  mpesa_amount numeric(14,2) not null default 0,
  mpesa_count int not null default 0,
  cash_amount numeric(14,2) not null default 0,
  cash_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_matatu_trips_matatu on public.matatu_trips(matatu_id);
create index if not exists idx_matatu_trips_status on public.matatu_trips(status);
create index if not exists idx_matatu_trips_started on public.matatu_trips(started_at);
