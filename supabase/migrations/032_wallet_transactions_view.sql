-- Safe wallet transactions view for dashboards
-- Shows ledger entries with wallet codes/labels, still enforced by RLS on ledger_entries

drop view if exists public.wallet_transactions_teketeke;
drop view if exists public.wallet_transactions_view;

create or replace view public.wallet_transactions_view as
select
  le.id,
  le.domain,
  le.created_at,
  le.kind,
  le.amount,
  le.currency,
  le.reference,
  le.narrative,

  le.from_wallet_id,
  wf.wallet_type as from_wallet_type,
  wf.wallet_code as from_wallet_code,
  wf.label       as from_wallet_label,

  le.to_wallet_id,
  wt.wallet_type as to_wallet_type,
  wt.wallet_code as to_wallet_code,
  wt.label       as to_wallet_label
from public.ledger_entries le
left join public.wallets wf on wf.id = le.from_wallet_id
left join public.wallets wt on wt.id = le.to_wallet_id
where le.domain = 'teketeke';

-- Optional helper alias (keeps name stable if you add more domains later)
create or replace view public.wallet_transactions_teketeke as
select * from public.wallet_transactions_view;

grant select on public.wallet_transactions_view to authenticated;
grant select on public.wallet_transactions_teketeke to authenticated;
