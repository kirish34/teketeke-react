-- 052_boda_bikes.sql
create table if not exists public.boda_riders (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  id_number text not null,
  phone text not null,
  email text,
  address text,
  stage text,
  town text,
  date_of_birth date,
  created_at timestamptz not null default now()
);

create table if not exists public.boda_bikes (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  make text,
  model text,
  year int,
  operator_id uuid not null references public.saccos(id) on delete restrict,
  till_number text,
  license_no text,
  has_helmet boolean not null default false,
  has_reflector boolean not null default false,
  rider_id uuid not null references public.boda_riders(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(identifier)
);

create index if not exists idx_boda_bikes_operator on public.boda_bikes(operator_id);
create index if not exists idx_boda_bikes_rider on public.boda_bikes(rider_id);
