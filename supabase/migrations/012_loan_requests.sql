-- 012_loan_requests.sql
-- Minimal loan_requests table for owner-submitted requests

create table if not exists public.loan_requests (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  matatu_id uuid references public.matatus(id) on delete set null,
  owner_name text,
  amount_kes numeric not null,
  model text not null check (model in ('DAILY','WEEKLY','MONTHLY')),
  term_months int not null check (term_months >= 1 and term_months <= 12),
  note text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists idx_loan_requests_sacco on public.loan_requests(sacco_id);
create index if not exists idx_loan_requests_status on public.loan_requests(status);

