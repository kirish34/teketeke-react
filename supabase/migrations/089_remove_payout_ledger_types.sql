-- 089_remove_payout_ledger_types.sql
-- Remove legacy payout ledger types and normalize existing rows.

-- Temporarily drop the no-update guard to allow cleanup.
drop trigger if exists wallet_ledger_no_update on public.wallet_ledger;

update public.wallet_ledger
set entry_type = 'MANUAL_ADJUSTMENT'
where entry_type = 'PAYOUT_DEBIT';

update public.wallet_ledger
set reference_type = 'ADMIN'
where reference_type = 'PAYOUT_ITEM';

-- Restore append-only guard.
create trigger wallet_ledger_no_update
before update on public.wallet_ledger
for each row execute function public.wallet_ledger_no_mutation();

alter table public.wallet_ledger
  drop constraint if exists wallet_ledger_entry_type_check;

alter table public.wallet_ledger
  add constraint wallet_ledger_entry_type_check
    check (entry_type in ('C2B_CREDIT','STK_CREDIT','MANUAL_ADJUSTMENT','REVERSAL'));

alter table public.wallet_ledger
  drop constraint if exists wallet_ledger_reference_type_check;

alter table public.wallet_ledger
  add constraint wallet_ledger_reference_type_check
    check (reference_type in ('MPESA_C2B','ADMIN'));
