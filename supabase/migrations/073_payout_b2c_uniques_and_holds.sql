-- 073_payout_b2c_uniques_and_holds.sql
-- Make payout callbacks uniquely match items and enforce single hold per reference.

-- Ensure reference columns exist on wallet_holds (idempotent)
alter table if exists public.wallet_holds
  add column if not exists reference_type text,
  add column if not exists reference_id text;

-- Unique per payout item callback identifiers (Daraja B2C)
create unique index if not exists payout_items_provider_request_uq
  on public.payout_items(provider_request_id)
  where provider_request_id is not null;

create unique index if not exists payout_items_provider_conversation_uq
  on public.payout_items(provider_conversation_id)
  where provider_conversation_id is not null;

-- One hold per reference (e.g., per payout item)
create unique index if not exists wallet_holds_reference_uq
  on public.wallet_holds(reference_type, reference_id)
  where reference_type is not null and reference_id is not null;
