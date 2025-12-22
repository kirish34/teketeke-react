-- Device registry + telemetry tables with RLS for TekeTeke

-- registry_devices
create table if not exists public.registry_devices (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  label text not null,
  device_type text not null,
  vendor text null,
  model text null,
  serial text null,
  imei text null,
  sim_msisdn text null,
  sim_iccid text null,
  status text not null default 'offline',
  last_seen_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now()
);
create index if not exists registry_devices_domain_idx on public.registry_devices(domain);
create index if not exists registry_devices_status_idx on public.registry_devices(status);

-- registry_assignments
create table if not exists public.registry_assignments (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  device_id uuid not null references public.registry_devices(id) on delete cascade,
  sacco_id uuid not null,
  matatu_id uuid not null,
  route_id uuid null,
  active boolean not null default true,
  assigned_at timestamptz not null default now()
);
create index if not exists registry_assignments_domain_idx on public.registry_assignments(domain);
create index if not exists registry_assignments_device_idx on public.registry_assignments(device_id);
create index if not exists registry_assignments_active_idx on public.registry_assignments(active);

-- device heartbeats (lightweight)
create table if not exists public.device_heartbeats (
  id bigserial primary key,
  domain text not null default 'teketeke',
  device_id uuid null references public.registry_devices(id) on delete set null,
  sacco_id uuid null,
  matatu_id uuid null,
  route_id uuid null,
  ts timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);
create index if not exists device_heartbeats_domain_idx on public.device_heartbeats(domain);
create index if not exists device_heartbeats_device_idx on public.device_heartbeats(device_id);
create index if not exists device_heartbeats_ts_idx on public.device_heartbeats(ts desc);

-- device telemetry bursts
create table if not exists public.device_telemetry (
  id bigserial primary key,
  domain text not null default 'teketeke',
  device_id uuid null references public.registry_devices(id) on delete set null,
  sacco_id uuid null,
  matatu_id uuid null,
  route_id uuid null,
  ts timestamptz not null default now(),
  lat numeric null,
  lon numeric null,
  speed_kph numeric null,
  heading numeric null,
  ignition boolean null,
  passenger_count int null,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists device_telemetry_domain_idx on public.device_telemetry(domain);
create index if not exists device_telemetry_device_idx on public.device_telemetry(device_id);
create index if not exists device_telemetry_ts_idx on public.device_telemetry(ts desc);

-- RLS
alter table public.registry_devices enable row level security;
alter table public.registry_assignments enable row level security;
alter table public.device_heartbeats enable row level security;
alter table public.device_telemetry enable row level security;

-- registry_devices policies
drop policy if exists "registry_devices_select_admin" on public.registry_devices;
create policy "registry_devices_select_admin"
on public.registry_devices
for select
to authenticated
using (domain = 'teketeke' and public.is_any_admin_teketeke(auth.uid()));

drop policy if exists "registry_devices_write_admin" on public.registry_devices;
create policy "registry_devices_write_admin"
on public.registry_devices
for all
to authenticated
using (domain = 'teketeke' and public.is_any_admin_teketeke(auth.uid()))
with check (domain = 'teketeke' and public.is_any_admin_teketeke(auth.uid()));

-- registry_assignments policies
drop policy if exists "registry_assignments_select_admin" on public.registry_assignments;
create policy "registry_assignments_select_admin"
on public.registry_assignments
for select
to authenticated
using (domain = 'teketeke' and public.is_any_admin_teketeke(auth.uid()));

drop policy if exists "registry_assignments_write_admin" on public.registry_assignments;
create policy "registry_assignments_write_admin"
on public.registry_assignments
for all
to authenticated
using (domain = 'teketeke' and public.is_any_admin_teketeke(auth.uid()))
with check (domain = 'teketeke' and public.is_any_admin_teketeke(auth.uid()));

-- device_heartbeats policies (read only for admins; no client writes)
drop policy if exists "device_heartbeats_select_admin" on public.device_heartbeats;
create policy "device_heartbeats_select_admin"
on public.device_heartbeats
for select
to authenticated
using (domain = 'teketeke' and public.is_any_admin_teketeke(auth.uid()));

drop policy if exists "device_heartbeats_no_client_write" on public.device_heartbeats;
create policy "device_heartbeats_no_client_write"
on public.device_heartbeats
for all
to authenticated
using (false)
with check (false);

-- device_telemetry policies (read only for admins; no client writes)
drop policy if exists "device_telemetry_select_admin" on public.device_telemetry;
create policy "device_telemetry_select_admin"
on public.device_telemetry
for select
to authenticated
using (domain = 'teketeke' and public.is_any_admin_teketeke(auth.uid()));

drop policy if exists "device_telemetry_no_client_write" on public.device_telemetry;
create policy "device_telemetry_no_client_write"
on public.device_telemetry
for all
to authenticated
using (false)
with check (false);
