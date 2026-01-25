-- 077_wallet_ledger_opening_balance_backfill.sql
-- One-time backfill: create opening balance ledger entries for legacy wallets with balance but no ledger history.

with candidates as (
  select
    id as wallet_id,
    balance,
    case when balance > 0 then 'CREDIT' else 'DEBIT' end as direction,
    abs(balance) as amount
  from public.wallets
  where domain = 'teketeke'
    and balance <> 0
    and not exists (
      select 1 from public.wallet_ledger wl where wl.wallet_id = wallets.id
    )
)
insert into public.wallet_ledger (
  wallet_id,
  direction,
  amount,
  balance_before,
  balance_after,
  entry_type,
  reference_type,
  reference_id,
  description,
  provider,
  provider_ref,
  source,
  source_ref,
  created_at
)
select
  c.wallet_id,
  c.direction,
  c.amount,
  0,
  c.balance,
  'MANUAL_ADJUSTMENT',
  'ADMIN',
  'SYSTEM_BACKFILL:' || c.wallet_id::text,
  'Backfill opening balance',
  'SYSTEM',
  'OPENING_BALANCE',
  'SYSTEM',
  'OPENING_BALANCE',
  now()
from candidates c
where not exists (
  select 1 from public.wallet_ledger wl
  where wl.reference_type = 'ADMIN'
    and wl.reference_id = 'SYSTEM_BACKFILL:' || c.wallet_id::text
);

-- Refresh balance MVs to incorporate backfilled ledger entries
select public.refresh_wallet_balances_mv();
