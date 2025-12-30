-- 051_taxis.sql
create table if not exists public.taxi_owners (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  id_number text not null,
  phone text not null,
  email text,
  address text,
  license_no text,
  date_of_birth date,
  created_at timestamptz not null default now()
);

create table if not exists public.taxis (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  make text,
  model text,
  year int,
  operator_id uuid not null references public.saccos(id) on delete restrict,
  till_number text,
  seat_capacity int,
  category text not null,
  category_other text,
  owner_id uuid not null references public.taxi_owners(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(plate)
);

create index if not exists idx_taxis_operator on public.taxis(operator_id);
create index if not exists idx_taxis_owner on public.taxis(owner_id);
