-- 067_sacco_payouts.sql
-- SACCO payout destinations, batches, items, and audit events

create table if not exists public.payout_destinations (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  destination_type text not null,
  destination_ref text not null,
  destination_name text null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists payout_destinations_entity_idx
  on public.payout_destinations(entity_type, entity_id);

do $$ begin
  alter table public.payout_destinations
    add constraint payout_destinations_entity_type_chk
    check (entity_type in ('SACCO'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.payout_destinations
    add constraint payout_destinations_type_chk
    check (destination_type in ('PAYBILL_TILL','MSISDN'));
exception when duplicate_object then null; end $$;

create table if not exists public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null,
  date_from date not null,
  date_to date not null,
  status text not null,
  created_by uuid not null,
  approved_by uuid null,
  approved_at timestamptz null,
  total_amount numeric not null default 0,
  currency text not null default 'KES',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payout_batches_sacco_idx on public.payout_batches(sacco_id);
create index if not exists payout_batches_status_idx on public.payout_batches(status);
create index if not exists payout_batches_date_idx on public.payout_batches(date_from, date_to);

do $$ begin
  alter table public.payout_batches
    add constraint payout_batches_status_chk
    check (status in ('DRAFT','SUBMITTED','APPROVED','PROCESSING','COMPLETED','FAILED','CANCELLED'));
exception when duplicate_object then null; end $$;

drop trigger if exists payout_batches_set_updated_at on public.payout_batches;
create trigger payout_batches_set_updated_at
before update on public.payout_batches
for each row execute function public.set_updated_at();

create table if not exists public.payout_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.payout_batches(id) on delete cascade,
  wallet_id uuid references public.wallets(id),
  wallet_kind text not null,
  amount numeric not null,
  destination_type text not null,
  destination_ref text not null,
  status text not null,
  idempotency_key text not null unique,
  provider text not null default 'MPESA',
  provider_request_id text null,
  provider_receipt text null,
  failure_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payout_items_batch_idx on public.payout_items(batch_id);
create index if not exists payout_items_wallet_idx on public.payout_items(wallet_id);
create index if not exists payout_items_status_idx on public.payout_items(status);

do $$ begin
  alter table public.payout_items
    add constraint payout_items_wallet_kind_chk
    check (wallet_kind in ('FEE','LOAN','SAVINGS'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.payout_items
    add constraint payout_items_destination_type_chk
    check (destination_type in ('PAYBILL_TILL','MSISDN'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.payout_items
    add constraint payout_items_status_chk
    check (status in ('PENDING','SENT','CONFIRMED','FAILED','CANCELLED'));
exception when duplicate_object then null; end $$;

drop trigger if exists payout_items_set_updated_at on public.payout_items;
create trigger payout_items_set_updated_at
before update on public.payout_items
for each row execute function public.set_updated_at();

create table if not exists public.payout_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid null references public.payout_batches(id) on delete cascade,
  item_id uuid null references public.payout_items(id) on delete cascade,
  actor_id uuid null,
  event_type text not null,
  message text null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payout_events_batch_idx on public.payout_events(batch_id);
create index if not exists payout_events_item_idx on public.payout_events(item_id);

-- RLS
alter table public.payout_destinations enable row level security;
alter table public.payout_batches enable row level security;
alter table public.payout_items enable row level security;
alter table public.payout_events enable row level security;

drop policy if exists "payout_destinations_select" on public.payout_destinations;
create policy "payout_destinations_select"
on public.payout_destinations
for select
using (
  is_system_admin(auth.uid())
  or is_sacco_admin(auth.uid(), entity_id)
);

drop policy if exists "payout_destinations_insert" on public.payout_destinations;
create policy "payout_destinations_insert"
on public.payout_destinations
for insert
with check (
  is_system_admin(auth.uid())
  or is_sacco_admin(auth.uid(), entity_id)
);

drop policy if exists "payout_destinations_update" on public.payout_destinations;
create policy "payout_destinations_update"
on public.payout_destinations
for update
using (
  is_system_admin(auth.uid())
  or is_sacco_admin(auth.uid(), entity_id)
);

drop policy if exists "payout_destinations_delete" on public.payout_destinations;
create policy "payout_destinations_delete"
on public.payout_destinations
for delete
using (
  is_system_admin(auth.uid())
);

drop policy if exists "payout_batches_select" on public.payout_batches;
create policy "payout_batches_select"
on public.payout_batches
for select
using (
  is_system_admin(auth.uid())
  or is_sacco_admin(auth.uid(), sacco_id)
);

drop policy if exists "payout_batches_write" on public.payout_batches;
create policy "payout_batches_write"
on public.payout_batches
for all
using (
  is_system_admin(auth.uid())
  or is_sacco_admin(auth.uid(), sacco_id)
)
with check (
  is_system_admin(auth.uid())
  or is_sacco_admin(auth.uid(), sacco_id)
);

drop policy if exists "payout_items_select" on public.payout_items;
create policy "payout_items_select"
on public.payout_items
for select
using (
  is_system_admin(auth.uid())
  or exists (
    select 1
    from public.payout_batches b
    where b.id = payout_items.batch_id
      and is_sacco_admin(auth.uid(), b.sacco_id)
  )
);

drop policy if exists "payout_items_write" on public.payout_items;
create policy "payout_items_write"
on public.payout_items
for all
using (
  is_system_admin(auth.uid())
  or exists (
    select 1
    from public.payout_batches b
    where b.id = payout_items.batch_id
      and is_sacco_admin(auth.uid(), b.sacco_id)
  )
)
with check (
  is_system_admin(auth.uid())
  or exists (
    select 1
    from public.payout_batches b
    where b.id = payout_items.batch_id
      and is_sacco_admin(auth.uid(), b.sacco_id)
  )
);

drop policy if exists "payout_events_select" on public.payout_events;
create policy "payout_events_select"
on public.payout_events
for select
using (
  is_system_admin(auth.uid())
  or exists (
    select 1
    from public.payout_batches b
    where b.id = payout_events.batch_id
      and is_sacco_admin(auth.uid(), b.sacco_id)
  )
);
