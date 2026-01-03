-- 059_reconciliation_and_ops.sql
-- Daily reconciliation + risk + ops alerting + audit trail

-- Risk fields on mpesa_c2b_payments
alter table if exists public.mpesa_c2b_payments
  add column if not exists risk_score int not null default 0,
  add column if not exists risk_flags jsonb not null default '{}'::jsonb,
  add column if not exists risk_level text not null default 'LOW';

do $$ begin
  alter table public.mpesa_c2b_payments
    add constraint mpesa_c2b_payments_risk_level_check
    check (risk_level in ('LOW','MEDIUM','HIGH'));
exception when duplicate_object then null; end $$;

create index if not exists c2b_risk_level_idx on public.mpesa_c2b_payments(risk_level);

-- Daily reconciliation rollups
create table if not exists public.reconciliation_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  paybill_number text not null default '4814003',
  credited_total numeric not null default 0,
  credited_count int not null default 0,
  quarantined_total numeric not null default 0,
  quarantined_count int not null default 0,
  rejected_total numeric not null default 0,
  rejected_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists reconciliation_daily_set_updated_at on public.reconciliation_daily;
create trigger reconciliation_daily_set_updated_at
before update on public.reconciliation_daily
for each row execute function public.set_updated_at();

-- Ops alerts
create table if not exists public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null,
  severity text not null,
  entity_type text null,
  entity_id text null,
  payment_id uuid null references public.mpesa_c2b_payments(id) on delete set null,
  message text not null,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists ops_alerts_created_at_idx on public.ops_alerts(created_at);
create index if not exists ops_alerts_severity_idx on public.ops_alerts(severity);
create index if not exists ops_alerts_type_idx on public.ops_alerts(type);

-- C2B quarantine actions audit
create table if not exists public.c2b_actions_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  admin_user_id uuid null,
  payment_id uuid references public.mpesa_c2b_payments(id) on delete set null,
  action text not null,
  note text null,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists c2b_actions_payment_idx on public.c2b_actions_audit(payment_id);
create index if not exists c2b_actions_admin_idx on public.c2b_actions_audit(admin_user_id);

-- RLS (admin/service only)
alter table public.reconciliation_daily enable row level security;
alter table public.ops_alerts enable row level security;
alter table public.c2b_actions_audit enable row level security;

drop policy if exists "recon_no_client_access" on public.reconciliation_daily;
create policy "recon_no_client_access"
on public.reconciliation_daily
for all
to authenticated
using (false)
with check (false);

drop policy if exists "ops_alerts_no_client_access" on public.ops_alerts;
create policy "ops_alerts_no_client_access"
on public.ops_alerts
for all
to authenticated
using (false)
with check (false);

drop policy if exists "c2b_audit_no_client_access" on public.c2b_actions_audit;
create policy "c2b_audit_no_client_access"
on public.c2b_actions_audit
for all
to authenticated
using (false)
with check (false);
