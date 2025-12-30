-- 054_shuttle_care.sql
create table if not exists public.maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  shuttle_id uuid not null references public.shuttles(id) on delete cascade,
  operator_id uuid references public.saccos(id) on delete set null,
  reported_by_staff_id uuid references public.staff_profiles(id) on delete set null,
  handled_by_staff_id uuid references public.staff_profiles(id) on delete set null,
  issue_category text not null,
  issue_description text not null,
  parts_used jsonb,
  total_cost_kes numeric,
  downtime_days int,
  status text not null,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  next_service_due date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_maintenance_logs_shuttle on public.maintenance_logs(shuttle_id);
create index if not exists idx_maintenance_logs_operator on public.maintenance_logs(operator_id);
create index if not exists idx_maintenance_logs_status on public.maintenance_logs(status);
create index if not exists idx_maintenance_logs_occurred_at on public.maintenance_logs(occurred_at);
