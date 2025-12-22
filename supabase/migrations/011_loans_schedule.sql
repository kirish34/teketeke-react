-- 011_loans_schedule.sql
-- Minimal schedule metadata for loans

alter table if exists public.loans
  add column if not exists collection_model text not null default 'MONTHLY' check (collection_model in ('DAILY','WEEKLY','MONTHLY')),
  add column if not exists start_date date not null default (current_date);

create index if not exists idx_loans_start_date on public.loans(start_date);

