
-- 000_core_schema.sql
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- Enums
do $$ begin
  create type user_role as enum ('SYSTEM_ADMIN','SACCO_ADMIN','SACCO_STAFF');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tx_kind as enum ('SACCO_FEE','SAVINGS','LOAN_REPAY','CASH');
exception when duplicate_object then null; end $$;

do $$ begin
  create type loan_status as enum ('ACTIVE','CLOSED','DEFAULTED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ussd_status as enum ('AVAILABLE','ALLOCATED','RESERVED');
exception when duplicate_object then null; end $$;

-- Tables
create table if not exists public.saccos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  default_till text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.matatus (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  number_plate text not null,
  owner_name text,
  owner_phone text,
  vehicle_type text,
  tlb_number text,
  till_number text,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique(number_plate)
);

create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, -- references auth.users(id) when available
  sacco_id uuid references public.saccos(id) on delete cascade,
  role user_role not null default 'SACCO_STAFF',
  name text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  matatu_id uuid references public.matatus(id) on delete set null,
  kind tx_kind not null default 'SACCO_FEE',
  fare_amount_kes numeric not null default 0,
  service_fee_kes numeric not null default 0,
  status text not null default 'SUCCESS',
  passenger_msisdn text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  matatu_id uuid references public.matatus(id) on delete set null,
  borrower_name text not null,
  principal_kes numeric not null default 0,
  interest_rate_pct numeric not null default 0,
  term_months int not null default 0,
  status loan_status not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

create table if not exists public.ussd_pool (
  id uuid primary key default gen_random_uuid(),
  base text,
  checksum int,
  full_code text unique,
  status ussd_status not null default 'AVAILABLE',
  allocated_to_type text, -- 'SACCO' | 'MATATU'
  allocated_to_id uuid,
  allocated_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_matatus_sacco on public.matatus(sacco_id);
create index if not exists idx_tx_sacco on public.transactions(sacco_id);
create index if not exists idx_tx_matatu on public.transactions(matatu_id);
create index if not exists idx_loans_sacco on public.loans(sacco_id);
create index if not exists idx_ussd_status on public.ussd_pool(status);
