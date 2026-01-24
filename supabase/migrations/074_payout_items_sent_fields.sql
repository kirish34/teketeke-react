-- 074_payout_items_sent_fields.sql
-- Optional sent metadata for payout_items.

alter table public.payout_items
  add column if not exists sent_at timestamptz,
  add column if not exists provider_ack jsonb default '{}'::jsonb;

-- Allow in-flight send status
do $$ begin
  alter table public.payout_items drop constraint if exists payout_items_status_chk;
  alter table public.payout_items
    add constraint payout_items_status_chk
    check (status in ('PENDING','SENDING','SENT','CONFIRMED','FAILED','CANCELLED'));
exception when duplicate_object then null; end $$;
