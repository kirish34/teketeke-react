-- Maker-checker approval / rejection and backend helpers for payout lifecycle.

-- Approve / Reject (only sacco_admin or super_admin on the wallet; maker-checker enforced)
create or replace function public.approve_payout(
  p_payout_id uuid,
  p_action text,                 -- 'approve' | 'reject'
  p_note text default null
)
returns public.external_payout_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_req public.external_payout_requests%rowtype;
  v_new_status public.payout_status;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_payout_id is null then
    raise exception 'payout_id is required';
  end if;

  if p_action is null then
    raise exception 'action is required';
  end if;

  select * into v_req
  from public.external_payout_requests
  where id = p_payout_id
    and domain = 'teketeke';

  if v_req.id is null then
    raise exception 'Payout not found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'Only pending payouts can be approved/rejected. Current status=%', v_req.status;
  end if;

  if not public.has_wallet_role(
    v_req.wallet_id,
    array['sacco_admin','super_admin']::public.member_role[]
  ) then
    raise exception 'Not allowed to approve/reject payouts for this wallet';
  end if;

  if v_req.requested_by_user_id = v_uid then
    raise exception 'Maker-checker violation: requester cannot approve/reject their own payout';
  end if;

  if lower(trim(p_action)) = 'approve' then
    v_new_status := 'approved';
  elsif lower(trim(p_action)) = 'reject' then
    v_new_status := 'rejected';
  else
    raise exception 'Invalid action. Use approve or reject';
  end if;

  update public.external_payout_requests
  set
    status = v_new_status,
    approved_by_user_id = v_uid,
    approved_at = now(),
    failure_reason = case when v_new_status = 'rejected' then coalesce(p_note, 'Rejected by approver') else failure_reason end,
    updated_at = now()
  where id = v_req.id;

  select * into v_req
  from public.external_payout_requests
  where id = v_req.id;

  return v_req;
end $$;

grant execute on function public.approve_payout(uuid, text, text) to authenticated;


-- Optional helper: move approved -> processing (backend worker)
create or replace function public.mark_payout_processing(
  p_payout_id uuid,
  p_provider_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.external_payout_requests%rowtype;
begin
  select * into v_req
  from public.external_payout_requests
  where id = p_payout_id
    and domain = 'teketeke';

  if v_req.id is null then
    raise exception 'Payout not found';
  end if;

  if v_req.status <> 'approved' then
    raise exception 'Only approved payouts can be marked processing. Current status=%', v_req.status;
  end if;

  update public.external_payout_requests
  set
    status = 'processing',
    provider_reference = coalesce(p_provider_reference, provider_reference),
    updated_at = now()
  where id = p_payout_id;
end $$;

grant execute on function public.mark_payout_processing(uuid, text) to authenticated;


-- Optional helper: finalize payout (paid/failed) - typically called by backend worker
create or replace function public.finalize_payout(
  p_payout_id uuid,
  p_status text,                     -- 'paid' | 'failed'
  p_provider_reference text default null,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.external_payout_requests%rowtype;
  v_new public.payout_status;
begin
  select * into v_req
  from public.external_payout_requests
  where id = p_payout_id
    and domain = 'teketeke';

  if v_req.id is null then
    raise exception 'Payout not found';
  end if;

  if v_req.status not in ('approved','processing') then
    raise exception 'Only approved/processing payouts can be finalized. Current status=%', v_req.status;
  end if;

  if lower(trim(p_status)) = 'paid' then
    v_new := 'paid';
  elsif lower(trim(p_status)) = 'failed' then
    v_new := 'failed';
  else
    raise exception 'Invalid final status. Use paid or failed';
  end if;

  update public.external_payout_requests
  set
    status = v_new,
    provider_reference = coalesce(p_provider_reference, provider_reference),
    failure_reason = case when v_new = 'failed' then coalesce(p_failure_reason, 'Provider failed') else null end,
    updated_at = now()
  where id = p_payout_id;
end $$;

grant execute on function public.finalize_payout(uuid, text, text, text) to authenticated;
