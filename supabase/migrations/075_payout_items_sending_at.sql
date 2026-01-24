-- 075_payout_items_sending_at.sql
-- Track send attempt timestamps to allow safe reclaim of stuck payout items.

alter table public.payout_items
  add column if not exists sending_at timestamptz;

create index if not exists payout_items_sending_at_idx
  on public.payout_items(sending_at)
  where status = 'SENDING';
