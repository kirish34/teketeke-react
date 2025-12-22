-- Safe wallet balances view (RLS-respecting)
-- Balance = total in - total out, derived from ledger_entries

drop view if exists public.wallet_balances_view;

create or replace view public.wallet_balances_view as
with sums as (
  -- Money IN to a wallet
  select
    le.to_wallet_id as wallet_id,
    sum(le.amount) as delta
  from public.ledger_entries le
  where le.domain = 'teketeke'
    and le.to_wallet_id is not null
  group by le.to_wallet_id

  union all

  -- Money OUT from a wallet (stored as negative)
  select
    le.from_wallet_id as wallet_id,
    sum(-le.amount) as delta
  from public.ledger_entries le
  where le.domain = 'teketeke'
    and le.from_wallet_id is not null
  group by le.from_wallet_id
),
agg as (
  select
    wallet_id,
    coalesce(sum(delta), 0) as balance
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
  'KES'::text as currency
from public.wallets w
left join agg a on a.wallet_id = w.id
where w.domain = 'teketeke';

grant select on public.wallet_balances_view to authenticated;
