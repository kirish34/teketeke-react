-- Audit log for payouts

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_user_id uuid null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_entity_idx on public.audit_events(entity_type, entity_id);
create index if not exists audit_events_created_idx on public.audit_events(created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists "audit_select_admin" on public.audit_events;
create policy "audit_select_admin"
on public.audit_events
for select
to authenticated
using (domain='teketeke' and public.is_any_admin_teketeke(auth.uid()));

drop policy if exists "audit_select_owner_optional" on public.audit_events;
create policy "audit_select_owner_optional"
on public.audit_events
for select
to authenticated
using (
  domain='teketeke'
  and entity_type='payout'
  and exists (
    select 1
    from public.external_payout_requests pr
    join public.wallet_members wm on wm.wallet_id = pr.wallet_id
    where pr.id = audit_events.entity_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner','super_admin')
      and pr.domain = 'teketeke'
  )
);

drop policy if exists "audit_no_client_write" on public.audit_events;
create policy "audit_no_client_write"
on public.audit_events
for all
to authenticated
using (false)
with check (false);

create or replace function public.audit_payout_changes()
returns trigger language plpgsql security definer as $$
declare
  actor uuid;
begin
  actor := auth.uid();

  if tg_op = 'INSERT' then
    insert into public.audit_events(domain, entity_type, entity_id, action, actor_user_id, details)
    values (
      new.domain,
      'payout',
      new.id,
      'create',
      actor,
      jsonb_build_object(
        'wallet_id', new.wallet_id,
        'amount', new.amount,
        'destination_phone', new.destination_phone,
        'status', new.status
      )
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      insert into public.audit_events(domain, entity_type, entity_id, action, actor_user_id, details)
      values (
        new.domain,
        'payout',
        new.id,
        ('status:' || new.status),
        actor,
        jsonb_build_object(
          'from', old.status,
          'to', new.status,
          'provider_reference', new.provider_reference,
          'last_error', new.last_error
        )
      );
    end if;
    return new;
  end if;

  return new;
end $$;

drop trigger if exists trg_audit_payout_changes on public.external_payout_requests;
create trigger trg_audit_payout_changes
after insert or update on public.external_payout_requests
for each row execute function public.audit_payout_changes();
