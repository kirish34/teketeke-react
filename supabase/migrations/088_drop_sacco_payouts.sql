-- 088_drop_sacco_payouts.sql
-- Drop legacy SACCO payout tables and their dependent policies/triggers.

drop table if exists public.payout_items cascade;
drop table if exists public.payout_batches cascade;
drop table if exists public.payout_destinations cascade;
