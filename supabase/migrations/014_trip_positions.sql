-- 014_trip_positions.sql
-- GPS positions captured during matatu staff trips

create table if not exists public.trip_positions (
  id bigserial primary key,
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  matatu_id uuid not null references public.matatus(id) on delete cascade,
  staff_user_id uuid,
  route_id uuid references public.routes(id) on delete set null,
  trip_id text,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_trip_positions_sacco on public.trip_positions(sacco_id);
create index if not exists idx_trip_positions_matatu on public.trip_positions(matatu_id);
create index if not exists idx_trip_positions_trip on public.trip_positions(trip_id);
create index if not exists idx_trip_positions_recorded_at on public.trip_positions(recorded_at);

