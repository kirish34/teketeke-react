-- 049_shuttles.sql
create table if not exists public.shuttle_owners (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  id_number text not null,
  kra_pin text,
  phone text not null,
  email text,
  address text,
  occupation text,
  location text,
  date_of_birth date,
  created_at timestamptz not null default now()
);

create table if not exists public.shuttles (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  make text,
  model text,
  year int,
  operator_id uuid not null references public.saccos(id) on delete restrict,
  tlb_license text,
  till_number text not null,
  owner_id uuid not null references public.shuttle_owners(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(plate)
);

create index if not exists idx_shuttles_operator on public.shuttles(operator_id);
create index if not exists idx_shuttles_owner on public.shuttles(owner_id);
