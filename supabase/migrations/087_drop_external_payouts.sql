-- 087_drop_external_payouts.sql
-- Drop legacy external payout pipeline objects.

-- Worker monitor view (depends on external_payout_requests)
drop view if exists public.payout_worker_monitor_v;

-- Remove payout audit policy that references external_payout_requests
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'audit_events'
  ) then
    drop policy if exists "audit_select_owner_optional" on public.audit_events;
  end if;
end $$;

-- Core payout table + enum
drop table if exists public.external_payout_requests cascade;

-- Legacy payout triggers/functions
drop function if exists public.audit_payout_changes();
drop function if exists public.sync_payout_hold();
drop function if exists public.apply_paid_to_daily_usage();

drop function if exists public.guard_payout_wallet_type();
drop function if exists public.guard_maker_checker();
drop function if exists public.guard_payout_immutable_after_approval();
drop function if exists public.guard_payout_sufficient_available();
drop function if exists public.guard_owner_payout_phone_authorized();

drop function if exists public.request_payout(uuid, numeric, text, text);
drop function if exists public.request_payout_strict(uuid, numeric, text, text);
drop function if exists public.request_payout_strict(uuid, numeric, text, text, int, int);
drop function if exists public.approve_payout(uuid, text, text);
drop function if exists public.mark_payout_processing(uuid, text);
drop function if exists public.finalize_payout(uuid, text, text, text);
drop function if exists public.claim_next_payout(text, int);
drop function if exists public.schedule_payout_retry(uuid, timestamptz, text);
drop function if exists public.requeue_stuck_payouts(text, int, text);

drop type if exists public.payout_status;
