-- 076_wallet_balances_from_wallet_ledger.sql
-- Rebuild balance MVs to derive from wallet_ledger (runtime ledger) instead of legacy ledger_entries.

-- Drop dependent views/materialized views in dependency order
drop view if exists public.wallet_available_balances_secure;
drop materialized view if exists public.wallet_available_balances_mv;
drop view if exists public.wallet_balances_secure;
drop materialized view if exists public.wallet_balances_mv;

-- Canonical balances from wallet_ledger (last balance_after per wallet)
create materialized view public.wallet_balances_mv as
select
  w.id as wallet_id,
  w.domain,
  w.wallet_type,
  w.wallet_code,
  w.label,
  w.sacco_id,
  w.matatu_id,
  w.owner_id,
  coalesce(l.balance_after, 0) as ledger_balance,
  w.balance as wallet_balance,
  (w.balance - coalesce(l.balance_after, 0)) as drift,
  'KES'::text as currency,
  l.created_at as last_ledger_at,
  now() as refreshed_at
from public.wallets w
left join lateral (
  select balance_after, created_at
  from public.wallet_ledger wl
  where wl.wallet_id = w.id
  order by wl.created_at desc, wl.id desc
  limit 1
) l on true
where w.domain = 'teketeke';

create unique index if not exists wallet_balances_mv_wallet_id_uq
  on public.wallet_balances_mv(wallet_id);

-- Restrict direct MV access; expose secure view
revoke all on public.wallet_balances_mv from anon, authenticated;

create or replace view public.wallet_balances_secure as
select *
from public.wallet_balances_mv mv
where public.is_wallet_member(mv.wallet_id);

grant select on public.wallet_balances_secure to authenticated;

-- Available balances MV (wallet balance minus active holds)
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
  b.wallet_balance as total_balance,
  coalesce(h.held_amount, 0) as held_balance,
  (b.wallet_balance - coalesce(h.held_amount, 0)) as available_balance,
  b.currency,
  b.last_ledger_at,
  b.drift,
  now() as refreshed_at
from public.wallet_balances_mv b
left join holds h on h.wallet_id = b.wallet_id
where b.domain = 'teketeke';

create unique index if not exists wallet_available_balances_mv_wallet_id_uq
  on public.wallet_available_balances_mv(wallet_id);

-- Restrict direct MV access; expose secure view
revoke all on public.wallet_available_balances_mv from anon, authenticated;

create or replace view public.wallet_available_balances_secure as
select *
from public.wallet_available_balances_mv mv
where public.is_wallet_member(mv.wallet_id);

grant select on public.wallet_available_balances_secure to authenticated;

-- Refresh helper (cron-friendly)
create or replace function public.refresh_wallet_balances_mv()
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
        'refresh_wallet_balances_from_ledger_every_5min',
        '*/5 * * * *',
        'select public.refresh_wallet_balances_mv();'
      );
    exception when others then
      null;
    end;
  end if;
end $$;
