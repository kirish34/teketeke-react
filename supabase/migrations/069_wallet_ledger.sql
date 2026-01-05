-- Wallet ledger (append-only) for auditable balance changes
create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  direction text not null,
  amount numeric(14,2) not null check (amount > 0),
  balance_before numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  entry_type text not null,
  reference_type text not null,
  reference_id text not null,
  description text null,
  created_at timestamptz not null default now(),
  constraint wallet_ledger_direction_check
    check (direction in ('CREDIT','DEBIT')),
  constraint wallet_ledger_entry_type_check
    check (entry_type in ('C2B_CREDIT','STK_CREDIT','PAYOUT_DEBIT','MANUAL_ADJUSTMENT','REVERSAL')),
  constraint wallet_ledger_reference_type_check
    check (reference_type in ('MPESA_C2B','PAYOUT_ITEM','ADMIN'))
);

create index if not exists wallet_ledger_wallet_idx
on public.wallet_ledger(wallet_id, created_at desc);

create index if not exists wallet_ledger_reference_idx
on public.wallet_ledger(reference_type, reference_id);

-- Enforce append-only ledger: block updates/deletes
create or replace function public.wallet_ledger_no_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'wallet_ledger is append-only';
end $$;

drop trigger if exists wallet_ledger_no_update on public.wallet_ledger;
create trigger wallet_ledger_no_update
before update on public.wallet_ledger
for each row execute function public.wallet_ledger_no_mutation();

drop trigger if exists wallet_ledger_no_delete on public.wallet_ledger;
create trigger wallet_ledger_no_delete
before delete on public.wallet_ledger
for each row execute function public.wallet_ledger_no_mutation();

-- RLS: view-only for wallet members, no client writes
alter table public.wallet_ledger enable row level security;

drop policy if exists "wallet_ledger_select_wallet_member" on public.wallet_ledger;
create policy "wallet_ledger_select_wallet_member"
on public.wallet_ledger
for select
to authenticated
using (
  public.is_wallet_member(wallet_id)
);

drop policy if exists "wallet_ledger_no_client_write" on public.wallet_ledger;
create policy "wallet_ledger_no_client_write"
on public.wallet_ledger
for all
to authenticated
using (false)
with check (false);
