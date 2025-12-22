-- TekeTeke Multi-role core schema
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

create table if not exists saccos (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  default_till text,
  created_at timestamptz default now()
);

create table if not exists matatus (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid references saccos(id) on delete cascade,
  number_plate text unique not null,
  owner_name text,
  owner_phone text,
  vehicle_type text default 'MATATU',
  tlb_number text,
  till_number text,
  created_at timestamptz default now()
);

create table if not exists fees_payments (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid references saccos(id) on delete set null,
  matatu_id uuid references matatus(id) on delete set null,
  amount numeric(12,2) not null,
  client_request_id text,
  created_at timestamptz default now()
);
create unique index if not exists fees_unique_req on fees_payments(client_request_id) where client_request_id is not null;

create table if not exists loan_payments (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid references saccos(id) on delete set null,
  matatu_id uuid references matatus(id) on delete set null,
  amount numeric(12,2) not null,
  client_request_id text,
  created_at timestamptz default now()
);
create unique index if not exists loan_unique_req on loan_payments(client_request_id) where client_request_id is not null;

create table if not exists ussd_pool (
  id uuid primary key default gen_random_uuid(),
  base text not null,
  checksum text not null,
  allocated boolean default false
);

create table if not exists ussd_allocations (
  id uuid primary key default gen_random_uuid(),
  full_code text not null,
  level text not null, -- MATATU|SACCO
  matatu_id uuid references matatus(id) on delete set null,
  sacco_id uuid references saccos(id) on delete set null,
  allocated_at timestamptz default now()
);

create table if not exists user_roles (
  user_id uuid primary key,
  role text not null check (role in ('SACCO','SACCO_STAFF','OWNER','STAFF','TAXI','BODA','USER')),
  sacco_id uuid references saccos(id) on delete set null,
  matatu_id uuid references matatus(id) on delete set null,
  created_at timestamptz default now()
);

-- Seed basic USSD pool if empty
do $$
declare i int;
declare c int;
begin
  if (select count(*) from ussd_pool) = 0 then
    for i in 1000..1199 loop
      c := ( (i/1000)%10 + (i/100)%10 + (i/10)%10 + (i%10) ) % 10;
      insert into ussd_pool(base, checksum, allocated) values (i::text, c::text, false);
    end loop;
  end if;
end;
$$;
