-- 070_wallet_ledger_idempotency_and_balances.sql
-- Hard idempotency on wallet_ledger + rebuild balance materialized views from wallet_ledger (not ledger_entries).

-- 1) Idempotency guards on wallet_ledger
create unique index if not exists wallet_ledger_reference_uq
  on public.wallet_ledger(reference_type, reference_id)
  where reference_type is not null and reference_id is not null;

create unique index if not exists wallet_ledger_provider_ref_uq
  on public.wallet_ledger(provider, provider_ref)
  where provider is not null and provider_ref is not null;

-- Drop dependent views/materialized views in dependency order
drop view if exists public.wallet_available_balances_secure;
drop materialized view if exists public.wallet_available_balances_mv;
drop view if exists public.wallet_balances_live;
drop view if exists public.wallet_balances_secure;
drop materialized view if exists public.wallet_balances_mv;

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
  coalesce(l.balance_after, 0) as balance,
  'KES'::text as currency,
  l.id as last_ledger_id,
  l.created_at as last_ledger_at,
  (w.balance - coalesce(l.balance_after, 0)) as drift,
  now() as refreshed_at
from public.wallets w
left join lateral (
  select id, balance_after, created_at
  from public.wallet_ledger wl
  where wl.wallet_id = w.id
  order by wl.created_at desc, wl.id desc
  limit 1
) l on true
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

-- 3) Rebuild wallet_available_balances_mv to use the new wallet_balances_mv
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
  b.last_ledger_id,
  b.last_ledger_at,
  b.drift,
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
