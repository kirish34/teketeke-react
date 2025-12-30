-- 055_vehicle_care.sql
-- Polymorphic maintenance logs + access grants + fleet management flag.

alter table if exists public.maintenance_logs
  add column if not exists asset_type text;

alter table if exists public.maintenance_logs
  add column if not exists asset_id uuid;

alter table if exists public.maintenance_logs
  add column if not exists created_by_user_id uuid;

alter table if exists public.maintenance_logs
  add column if not exists handled_by_user_id uuid;

alter table if exists public.maintenance_logs
  add column if not exists reported_by text;

alter table if exists public.maintenance_logs
  add column if not exists issue_tags text[];

alter table if exists public.maintenance_logs
  add column if not exists priority text;

alter table if exists public.maintenance_logs
  add column if not exists updated_at timestamptz default now();

-- Backfill polymorphic fields from legacy shuttle_id when possible.
update public.maintenance_logs
  set asset_type = coalesce(asset_type, 'SHUTTLE'),
      asset_id = coalesce(asset_id, shuttle_id)
where asset_id is null and shuttle_id is not null;

update public.maintenance_logs ml
  set operator_id = coalesce(ml.operator_id, s.operator_id)
from public.shuttles s
where ml.operator_id is null
  and ml.shuttle_id is not null
  and s.id = ml.shuttle_id;

-- Access grants for delegated permissions.
create table if not exists public.access_grants (
  id uuid primary key default gen_random_uuid(),
  granter_type text not null,
  granter_id uuid not null,
  user_id uuid not null,
  scope_type text not null,
  scope_id uuid not null,
  role text not null,
  can_manage_staff boolean not null default false,
  can_manage_vehicles boolean not null default false,
  can_manage_vehicle_care boolean not null default false,
  can_manage_compliance boolean not null default false,
  can_view_analytics boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_access_grants_user on public.access_grants(user_id);
create index if not exists idx_access_grants_scope on public.access_grants(scope_type, scope_id);
create index if not exists idx_access_grants_granter on public.access_grants(granter_type, granter_id);

alter table if exists public.saccos
  add column if not exists manages_fleet boolean not null default false;

create index if not exists idx_maintenance_logs_operator_asset on public.maintenance_logs(operator_id, asset_type);
create index if not exists idx_maintenance_logs_asset on public.maintenance_logs(asset_type, asset_id);
