-- Worker heartbeat + monitor view

-- helper (safe if exists)
create or replace function public.is_any_admin_teketeke(p_uid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1
    from public.wallet_members wm
    join public.wallets w on w.id = wm.wallet_id
    where w.domain='teketeke'
      and wm.user_id=p_uid
      and w.is_active=true
      and wm.role in ('sacco_admin','super_admin')
  );
$$;
grant execute on function public.is_any_admin_teketeke(uuid) to authenticated;

create table if not exists public.worker_heartbeat (
  id int primary key default 1,
  domain text not null default 'teketeke',
  last_tick_at timestamptz not null default now(),
  note text null
);

insert into public.worker_heartbeat(id, domain)
values (1,'teketeke')
on conflict (id) do nothing;

alter table public.worker_heartbeat enable row level security;

drop policy if exists "heartbeat_select_admin" on public.worker_heartbeat;
create policy "heartbeat_select_admin"
on public.worker_heartbeat
for select
to authenticated
using (
  domain='teketeke'
  and public.is_any_admin_teketeke(auth.uid())
);

drop policy if exists "heartbeat_no_client_write" on public.worker_heartbeat;
create policy "heartbeat_no_client_write"
on public.worker_heartbeat
for all
to authenticated
using (false)
with check (false);

-- Monitor view (no RLS on views; gate via UI/admin routes)
create or replace view public.payout_worker_monitor_v as
select
  'teketeke'::text as domain,
  (select count(*) from public.external_payout_requests where domain='teketeke' and status='pending') as pending,
  (select count(*) from public.external_payout_requests where domain='teketeke' and status='approved') as approved,
  (select count(*) from public.external_payout_requests where domain='teketeke' and status='processing') as processing,
  (select count(*) from public.external_payout_requests where domain='teketeke' and status='paid') as paid,
  (select count(*) from public.external_payout_requests where domain='teketeke' and status='failed') as failed,
  (select count(*) from public.external_payout_requests where domain='teketeke' and status='rejected') as rejected,
  (select count(*) from public.external_payout_requests where domain='teketeke' and status='cancelled') as cancelled,
  (select count(*)
   from public.external_payout_requests
   where domain='teketeke'
     and status='processing'
     and processing_started_at < now() - interval '10 minutes') as stuck_processing_10m,
  (select last_tick_at from public.worker_heartbeat where id=1) as last_worker_tick_at;

grant select on public.payout_worker_monitor_v to authenticated;
