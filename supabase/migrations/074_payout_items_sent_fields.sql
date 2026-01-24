-- 074_payout_items_sent_fields.sql
-- Optional sent metadata for payout_items.

alter table public.payout_items
  add column if not exists sent_at timestamptz,
  add column if not exists provider_ack jsonb default '{}'::jsonb;
