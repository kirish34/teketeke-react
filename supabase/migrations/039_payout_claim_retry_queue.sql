-- Payout queue helpers: claim next payout, schedule retry, requeue stuck jobs.

-- 1) Add queue fields (idempotent if rerun)
alter table public.external_payout_requests
  add column if not exists attempts int not null default 0,
  add column if not exists next_retry_at timestamptz null,
  add column if not exists processing_started_at timestamptz null,
  add column if not exists last_error text null;

create index if not exists payout_next_retry_idx
  on public.external_payout_requests(domain, status, next_retry_at);

create index if not exists payout_processing_started_idx
  on public.external_payout_requests(domain, status, processing_started_at);

-- 2) Claim next payout (approved -> processing) atomically
create or replace function public.claim_next_payout(
  p_domain text default 'teketeke',
  p_max_attempts int default 8
)
returns public.external_payout_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.external_payout_requests%rowtype;
begin
  with candidate as (
    select id
    from public.external_payout_requests
    where domain = p_domain
      and status = 'approved'
      and attempts < p_max_attempts
      and (next_retry_at is null or next_retry_at <= now())
    order by created_at asc
    limit 1
    for update skip locked
  )
  update public.external_payout_requests pr
  set
    status = 'processing',
    attempts = pr.attempts + 1,
    processing_started_at = now(),
    updated_at = now()
  where pr.id in (select id from candidate)
  returning * into v_row;

  return v_row;
end $$;

grant execute on function public.claim_next_payout(text, int) to authenticated;

-- 3) Schedule retry with backoff (processing/approved -> approved + next_retry_at)
create or replace function public.schedule_payout_retry(
  p_payout_id uuid,
  p_next_retry_at timestamptz,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.external_payout_requests%rowtype;
begin
  if p_payout_id is null then
    raise exception 'payout_id required';
  end if;

  select * into v_req
  from public.external_payout_requests
  where id = p_payout_id
    and domain = 'teketeke';

  if v_req.id is null then
    raise exception 'Payout not found';
  end if;

  if v_req.status in ('paid','cancelled','rejected','failed') then
    raise exception 'Cannot retry finalized payout. status=%', v_req.status;
  end if;

  update public.external_payout_requests
  set
    status = 'approved',
    next_retry_at = p_next_retry_at,
    last_error = p_error,
    updated_at = now()
  where id = p_payout_id;
end $$;

grant execute on function public.schedule_payout_retry(uuid, timestamptz, text) to authenticated;

-- 4) Requeue stuck processing payouts
create or replace function public.requeue_stuck_payouts(
  p_domain text default 'teketeke',
  p_stuck_minutes int default 10,
  p_error text default 'Worker timeout; requeued'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.external_payout_requests
  set
    status = 'approved',
    next_retry_at = now() + interval '1 minute',
    last_error = p_error,
    updated_at = now()
  where domain = p_domain
    and status = 'processing'
    and processing_started_at is not null
    and processing_started_at < now() - make_interval(mins => p_stuck_minutes);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.requeue_stuck_payouts(text, int, text) to authenticated;
