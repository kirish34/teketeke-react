-- 072_payout_holds_and_wallet_ledger_idempotency.sql
-- Strengthen wallet_ledger idempotency and make payout holds first-class for available balance checks.

-- 1) Idempotency guards on wallet_ledger (reaffirm)
create unique index if not exists wallet_ledger_reference_uq
  on public.wallet_ledger(reference_type, reference_id)
  where reference_type is not null and reference_id is not null;

create unique index if not exists wallet_ledger_provider_ref_uq
  on public.wallet_ledger(provider, provider_ref)
  where provider is not null and provider_ref is not null;

-- 2) Enhance wallet_holds for payouts
alter table if exists public.wallet_holds
  add column if not exists reason text,
  add column if not exists reference_type text,
  add column if not exists reference_id text,
  alter column status set default 'active';

do $$ begin
  alter table public.wallet_holds
    add constraint wallet_holds_status_check
    check (status in ('active','settled','released'));
exception when duplicate_object then null; end $$;

create index if not exists wallet_holds_reference_idx
  on public.wallet_holds(reference_type, reference_id);

-- 3) Available balance view already rebuilt to use wallet_ledger in 070; ensure holds are considered.
-- No further MV changes required here; refresh functions will pick up new holds columns if used.
