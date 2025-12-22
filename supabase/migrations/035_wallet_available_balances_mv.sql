-- Available balance with payout holds + secure view and cron-friendly refresh
-- Adds wallet_holds table, sync trigger on external_payout_requests, and MV for available balances.

-- 1) Holds table
create table if not exists public.wallet_holds (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',

  wallet_id uuid not null references public.wallets(id) on delete cascade,
  source text not null,                 -- e.g. 'payout'
  source_id uuid null,                  -- link to external_payout_requests.id

  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'KES',

  status text not null default 'active', -- active/released
  created_by_user_id uuid null,

  created_at timestamptz not null default now(),
  released_at timestamptz null
);

create index if not exists wallet_holds_wallet_idx on public.wallet_holds(wallet_id);
create index if not exists wallet_holds_source_idx on public.wallet_holds(source, source_id);

-- 2) RLS for holds (read-only to members; no client writes)
alter table public.wallet_holds enable row level security;

drop policy if exists "holds_select_members" on public.wallet_holds;
create policy "holds_select_members"
on public.wallet_holds
for select
to authenticated
using (
  domain = 'teketeke'
  and public.is_wallet_member(wallet_id)
);

drop policy if exists "holds_no_client_write" on public.wallet_holds;
create policy "holds_no_client_write"
on public.wallet_holds
for all
to authenticated
using (false)
with check (false);

-- 3) Available balance materialized view (balance - holds)
drop view if exists public.wallet_available_balances_secure;
drop materialized view if exists public.wallet_available_balances_mv;

create materialized view public.wallet_available_balances_mv as
with holds as (
  select
    wallet_id,
    coalesce(sum(amount), 0) as held_amount
  from public.wallet_holds
  where domain = 'teketeke'
    and status = 'active'
  group by wallet_id
)
select
  b.wallet_id,
  b.domain,
  b.wallet_type,
  b.wallet_code,
  b.label,
  b.sacco_id,
  b.matatu_id,
  b.owner_id,
  b.balance as total_balance,
  coalesce(h.held_amount, 0) as held_balance,
  (b.balance - coalesce(h.held_amount, 0)) as available_balance,
  b.currency,
  now() as refreshed_at
from public.wallet_balances_mv b
left join holds h on h.wallet_id = b.wallet_id
where b.domain = 'teketeke';

create unique index if not exists wallet_available_balances_mv_wallet_id_uq
on public.wallet_available_balances_mv(wallet_id);

-- Restrict direct MV access; expose through secure view
revoke all on public.wallet_available_balances_mv from anon, authenticated;

create or replace view public.wallet_available_balances_secure as
select *
from public.wallet_available_balances_mv mv
where public.is_wallet_member(mv.wallet_id);

grant select on public.wallet_available_balances_secure to authenticated;

-- 4) Sync payout holds with external_payout_requests status
create or replace function public.sync_payout_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_id uuid;
begin
  if new.domain <> 'teketeke' then
    return new;
  end if;

  if new.status in ('pending','approved','processing') then
    select id into hold_id
    from public.wallet_holds
    where domain = 'teketeke'
      and source = 'payout'
      and source_id = new.id
      and status = 'active'
    limit 1;

    if hold_id is null then
      insert into public.wallet_holds(domain, wallet_id, source, source_id, amount, currency, status, created_by_user_id)
      values ('teketeke', new.wallet_id, 'payout', new.id, new.amount, new.currency, 'active', new.requested_by_user_id);
    else
      update public.wallet_holds
      set amount = new.amount
      where id = hold_id;
    end if;

  else
    update public.wallet_holds
    set status = 'released', released_at = now()
    where domain = 'teketeke'
      and source = 'payout'
      and source_id = new.id
      and status = 'active';
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_payout_hold on public.external_payout_requests;
create trigger trg_sync_payout_hold
after insert or update of status, amount on public.external_payout_requests
for each row execute function public.sync_payout_hold();

-- 5) Refresh helper for both MVs
create or replace function public.refresh_all_wallet_mvs()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view public.wallet_balances_mv;
  refresh materialized view public.wallet_available_balances_mv;
$$;

-- Optional: schedule refresh every 5 minutes if pg_cron is available
do $$
declare
  has_cron boolean;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into has_cron;
  if has_cron then
    begin
      perform cron.schedule(
        'refresh_wallet_balances_all_mvs_5min',
        '*/5 * * * *',
        'select public.refresh_all_wallet_mvs();'
      );
    exception when others then
      null;
    end;
  end if;
end $$;
