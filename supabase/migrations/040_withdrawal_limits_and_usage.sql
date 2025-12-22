-- Withdrawal phone limits: per-tx, per-day, rate limit; upgraded request_payout_strict and daily usage tracking.

-- 0) Daily usage table (idempotent)
create table if not exists public.withdrawal_daily_usage (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',

  matatu_wallet_id uuid not null references public.wallets(id) on delete cascade,
  approved_phone text not null,
  day date not null,

  total_requested numeric(12,2) not null default 0,
  total_paid numeric(12,2) not null default 0,

  updated_at timestamptz not null default now(),
  unique(domain, matatu_wallet_id, approved_phone, day)
);

create index if not exists withdrawal_daily_usage_idx
on public.withdrawal_daily_usage(domain, matatu_wallet_id, approved_phone, day);

drop trigger if exists withdrawal_daily_usage_set_updated_at on public.withdrawal_daily_usage;
create trigger withdrawal_daily_usage_set_updated_at
before update on public.withdrawal_daily_usage
for each row execute function public.set_updated_at();

alter table public.withdrawal_daily_usage enable row level security;

drop policy if exists "usage_select_owner" on public.withdrawal_daily_usage;
create policy "usage_select_owner"
on public.withdrawal_daily_usage
for select
to authenticated
using (
  domain='teketeke'
  and public.has_wallet_role(matatu_wallet_id, array['owner','super_admin']::public.member_role[])
);

drop policy if exists "usage_no_client_write" on public.withdrawal_daily_usage;
create policy "usage_no_client_write"
on public.withdrawal_daily_usage
for all
to authenticated
using (false)
with check (false);

-- 1) Rate limit table (idempotent)
create table if not exists public.wallet_rate_limits (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',

  wallet_id uuid not null references public.wallets(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  window_seconds int not null,
  count int not null default 0,

  updated_at timestamptz not null default now(),
  unique(domain, wallet_id, bucket, window_start)
);

create index if not exists wallet_rate_limits_idx
on public.wallet_rate_limits(domain, wallet_id, bucket, window_start);

drop trigger if exists wallet_rate_limits_set_updated_at on public.wallet_rate_limits;
create trigger wallet_rate_limits_set_updated_at
before update on public.wallet_rate_limits
for each row execute function public.set_updated_at();

alter table public.wallet_rate_limits enable row level security;

drop policy if exists "wallet_rate_limits_no_client_access" on public.wallet_rate_limits;
create policy "wallet_rate_limits_no_client_access"
on public.wallet_rate_limits
for all
to authenticated
using (false)
with check (false);

-- 2) Upgraded strict payout RPC with limits and rate limiting
create or replace function public.request_payout_strict(
  p_wallet_id uuid,
  p_amount numeric,
  p_destination_phone text,
  p_reason_code text default null,
  p_rate_limit_max int default 3,
  p_rate_limit_window_seconds int default 120
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_uid uuid;
  v_wallet_type public.wallet_type;

  v_balance numeric;
  v_held numeric;
  v_available numeric;

  v_matatu_wallet_id uuid;
  v_phone text;

  v_auth_id uuid;
  v_max_per_tx numeric;
  v_max_per_day numeric;

  v_today date;

  v_usage_total_requested numeric;
  v_new_total_requested numeric;

  v_req_id uuid;

  v_now timestamptz;
  v_window_start timestamptz;
  v_count int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_wallet_id is null then
    raise exception 'wallet_id is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be > 0';
  end if;

  v_phone := trim(coalesce(p_destination_phone,''));
  if length(v_phone) < 9 then
    raise exception 'destination_phone is required';
  end if;

  if not public.has_wallet_role(
    p_wallet_id,
    array['owner','sacco_admin','super_admin']::public.member_role[]
  ) then
    raise exception 'Not allowed to request payout for this wallet';
  end if;

  select w.wallet_type
    into v_wallet_type
  from public.wallets w
  where w.id = p_wallet_id
    and w.domain = 'teketeke'
    and w.is_active = true;

  if v_wallet_type is null then
    raise exception 'Wallet not found or inactive';
  end if;

  if v_wallet_type in ('matatu','clearing') then
    raise exception 'Payouts are not allowed from % wallets', v_wallet_type;
  end if;

  -- Rate limit
  if p_rate_limit_window_seconds > 0 and p_rate_limit_max > 0 then
    v_now := now();
    v_window_start :=
      to_timestamp(
        floor(extract(epoch from v_now) / p_rate_limit_window_seconds) * p_rate_limit_window_seconds
      );

    insert into public.wallet_rate_limits(domain, wallet_id, bucket, window_start, window_seconds, count)
    values ('teketeke', p_wallet_id, 'payout_request', v_window_start, p_rate_limit_window_seconds, 1)
    on conflict (domain, wallet_id, bucket, window_start)
    do update set count = public.wallet_rate_limits.count + 1,
                  updated_at = now()
    returning count into v_count;

    if v_count > p_rate_limit_max then
      raise exception 'Rate limit exceeded. Try again later.';
    end if;
  end if;

  -- Owner strict phone authorization
  if v_wallet_type = 'owner' then
    select wl.to_wallet_id
      into v_matatu_wallet_id
    from public.wallet_links wl
    join public.wallets w_to on w_to.id = wl.to_wallet_id
    where wl.domain = 'teketeke'
      and wl.is_active = true
      and wl.link_type = 'owner_matatu'
      and wl.from_wallet_id = p_wallet_id
      and w_to.wallet_type = 'matatu'
    limit 1;

    if v_matatu_wallet_id is null then
      raise exception 'Owner wallet has no linked matatu wallet; cannot validate withdrawal phone';
    end if;

    select wa.id, wa.max_per_tx, wa.max_per_day
      into v_auth_id, v_max_per_tx, v_max_per_day
    from public.withdrawal_authorizations wa
    where wa.domain = 'teketeke'
      and wa.matatu_wallet_id = v_matatu_wallet_id
      and wa.is_active = true
      and wa.approved_phone = v_phone
    limit 1;

    if v_auth_id is null then
      raise exception 'Destination phone is not authorized for withdrawals';
    end if;

    if v_max_per_tx is not null and p_amount > v_max_per_tx then
      raise exception 'Amount exceeds max_per_tx. Limit=%, requested=%', v_max_per_tx, p_amount;
    end if;

    v_today := (now() at time zone 'Africa/Nairobi')::date;

    if v_max_per_day is not null then
      insert into public.withdrawal_daily_usage(domain, matatu_wallet_id, approved_phone, day, total_requested, total_paid)
      values ('teketeke', v_matatu_wallet_id, v_phone, v_today, 0, 0)
      on conflict (domain, matatu_wallet_id, approved_phone, day) do nothing;

      select total_requested
        into v_usage_total_requested
      from public.withdrawal_daily_usage
      where domain='teketeke'
        and matatu_wallet_id = v_matatu_wallet_id
        and approved_phone = v_phone
        and day = v_today
      for update;

      v_new_total_requested := coalesce(v_usage_total_requested, 0) + p_amount;

      if v_new_total_requested > v_max_per_day then
        raise exception 'Daily limit exceeded. Limit=%, would_be=%', v_max_per_day, v_new_total_requested;
      end if;

      update public.withdrawal_daily_usage
      set total_requested = v_new_total_requested,
          updated_at = now()
      where domain='teketeke'
        and matatu_wallet_id = v_matatu_wallet_id
        and approved_phone = v_phone
        and day = v_today;
    end if;
  end if;

  select coalesce(balance, 0)
    into v_balance
  from public.wallet_balances_live
  where wallet_id = p_wallet_id
  limit 1;

  select coalesce(sum(amount), 0)
    into v_held
  from public.wallet_holds
  where domain = 'teketeke'
    and wallet_id = p_wallet_id
    and status = 'active';

  v_available := v_balance - v_held;

  if p_amount > v_available then
    raise exception 'Insufficient available balance. Available=%, requested=%', v_available, p_amount;
  end if;

  insert into public.external_payout_requests(
    domain, wallet_id, requested_by_user_id,
    amount, currency,
    destination_phone,
    status, reason_code
  ) values (
    'teketeke', p_wallet_id, v_uid,
    p_amount, 'KES',
    v_phone,
    'pending', p_reason_code
  )
  returning id into v_req_id;

  return v_req_id;
end $$;

grant execute on function public.request_payout_strict(uuid, numeric, text, text, int, int) to authenticated;

-- 3) Update daily usage when payout is paid
create or replace function public.apply_paid_to_daily_usage()
returns trigger language plpgsql security definer as $$
declare
  wtype public.wallet_type;
  matatu_wallet uuid;
  v_today date;
begin
  if not (tg_op = 'UPDATE' and old.status <> 'paid' and new.status = 'paid') then
    return new;
  end if;

  if new.domain <> 'teketeke' then
    return new;
  end if;

  select wallet_type into wtype
  from public.wallets
  where id = new.wallet_id;

  if wtype <> 'owner' then
    return new;
  end if;

  select wl.to_wallet_id
    into matatu_wallet
  from public.wallet_links wl
  join public.wallets w_to on w_to.id = wl.to_wallet_id
  where wl.domain='teketeke'
    and wl.is_active=true
    and wl.link_type='owner_matatu'
    and wl.from_wallet_id = new.wallet_id
    and w_to.wallet_type='matatu'
  limit 1;

  if matatu_wallet is null then
    return new;
  end if;

  v_today := (now() at time zone 'Africa/Nairobi')::date;

  insert into public.withdrawal_daily_usage(domain, matatu_wallet_id, approved_phone, day, total_requested, total_paid)
  values ('teketeke', matatu_wallet, new.destination_phone, v_today, 0, 0)
  on conflict (domain, matatu_wallet_id, approved_phone, day) do nothing;

  update public.withdrawal_daily_usage
  set total_paid = total_paid + new.amount,
      updated_at = now()
  where domain='teketeke'
    and matatu_wallet_id = matatu_wallet
    and approved_phone = new.destination_phone
    and day = v_today;

  return new;
end $$;

drop trigger if exists trg_apply_paid_to_daily_usage on public.external_payout_requests;
create trigger trg_apply_paid_to_daily_usage
after update of status on public.external_payout_requests
for each row execute function public.apply_paid_to_daily_usage();
