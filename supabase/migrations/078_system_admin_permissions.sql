-- 078_system_admin_permissions.sql
-- Permissions toggles for system/super admins (finance, registry, monitoring, alerts).

create table if not exists public.system_admin_permissions (
  user_id uuid primary key,
  can_finance_act boolean not null default true,
  can_registry boolean not null default true,
  can_monitor boolean not null default true,
  can_alerts boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_system_admin_permissions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_system_admin_permissions_updated_at on public.system_admin_permissions;
create trigger trg_system_admin_permissions_updated_at
before update on public.system_admin_permissions
for each row
execute function public.touch_system_admin_permissions_updated_at();

create index if not exists idx_system_admin_permissions_active on public.system_admin_permissions(is_active);
