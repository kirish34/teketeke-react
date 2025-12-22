-- Materialized wallet balances with secure view and cron-friendly refresh
-- Uses existing membership helper is_wallet_member for row-level safety

drop view if exists public.wallet_balances_secure;
drop materialized view if exists public.wallet_balances_mv;

create materialized view public.wallet_balances_mv as
with sums as (
  -- money IN
  select
    le.to_wallet_id as wallet_id,
    sum(le.amount) as delta
  from public.ledger_entries le
  where le.domain = 'teketeke'
    and le.to_wallet_id is not null
  group by le.to_wallet_id

  union all

  -- money OUT (negative)
  select
    le.from_wallet_id as wallet_id,
    sum(-le.amount) as delta
  from public.ledger_entries le
  where le.domain = 'teketeke'
    and le.from_wallet_id is not null
  group by le.from_wallet_id
),
agg as (
  select wallet_id, coalesce(sum(delta), 0) as balance
  from sums
  group by wallet_id
)
select
  w.id as wallet_id,
  w.domain,
  w.wallet_type,
  w.wallet_code,
  w.label,
  w.sacco_id,
  w.matatu_id,
  w.owner_id,
  coalesce(a.balance, 0) as balance,
  'KES'::text as currency,
  now() as refreshed_at
from public.wallets w
left join agg a on a.wallet_id = w.id
where w.domain = 'teketeke';

create unique index if not exists wallet_balances_mv_wallet_id_uq
on public.wallet_balances_mv(wallet_id);

-- Restrict direct MV access; expose through secure view
revoke all on public.wallet_balances_mv from anon, authenticated;

create or replace view public.wallet_balances_secure as
select *
from public.wallet_balances_mv mv
where public.is_wallet_member(mv.wallet_id);

grant select on public.wallet_balances_secure to authenticated;

-- Refresh helper (can be called by pg_cron or manually)
create or replace function public.refresh_wallet_balances_mv()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view public.wallet_balances_mv;
$$;

-- Optional: schedule refresh every 5 minutes if pg_cron is available.
do $$
declare
  has_cron boolean;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into has_cron;
  if has_cron then
    begin
      perform cron.schedule(
        'refresh_wallet_balances_mv_every_5min',
        '*/5 * * * *',
        'select public.refresh_wallet_balances_mv();'
      );
    exception when others then
      -- ignore if job already exists or scheduling is not permitted
      null;
    end;
  end if;
end $$;
