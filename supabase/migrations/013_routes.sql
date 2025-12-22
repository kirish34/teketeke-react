-- 013_routes.sql
-- Basic routes table for SACCO-defined matatu routes

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  name text not null,
  code text,
  start_stop text,
  end_stop text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_routes_sacco on public.routes(sacco_id);
create index if not exists idx_routes_active on public.routes(active);

