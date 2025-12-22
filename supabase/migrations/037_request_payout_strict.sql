-- Strict payout request RPC enforcing approved phones, maker-checker alignment, and available balance.
-- Assumes owner->matatu link via wallet_links(link_type='owner_matatu') and withdrawal_authorizations on matatu wallet.

create or replace function public.request_payout_strict(
  p_wallet_id uuid,
  p_amount numeric,
  p_destination_phone text,
  p_reason_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_wallet_type public.wallet_type;
  v_balance numeric;
  v_held numeric;
  v_available numeric;

  v_matatu_wallet_id uuid;
  v_phone_ok boolean;

  v_req_id uuid;
begin
  -- Must be authenticated
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Basic input validation
  if p_wallet_id is null then
    raise exception 'wallet_id is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be > 0';
  end if;

  if p_destination_phone is null or length(trim(p_destination_phone)) < 9 then
    raise exception 'destination_phone is required';
  end if;

  -- Must be allowed role on this wallet
  if not public.has_wallet_role(
    p_wallet_id,
    array['owner','sacco_admin','super_admin']::public.member_role[]
  ) then
    raise exception 'Not allowed to request payout for this wallet';
  end if;

  -- Wallet must exist and be TekeTeke domain
  select w.wallet_type
    into v_wallet_type
  from public.wallets w
  where w.id = p_wallet_id
    and w.domain = 'teketeke'
    and w.is_active = true;

  if v_wallet_type is null then
    raise exception 'Wallet not found or inactive';
  end if;

  -- Hard block payouts from matatu and clearing wallets (defense-in-depth)
  if v_wallet_type in ('matatu','clearing') then
    raise exception 'Payouts are not allowed from % wallets', v_wallet_type;
  end if;

  -- STRICT MODE: enforce destination phone authorization for OWNER wallets
  if v_wallet_type = 'owner' then
    -- Find linked matatu wallet via wallet_links (owner -> matatu)
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

    -- Check destination phone is in approved list for that matatu wallet
    select exists (
      select 1
      from public.withdrawal_authorizations wa
      where wa.domain = 'teketeke'
        and wa.matatu_wallet_id = v_matatu_wallet_id
        and wa.is_active = true
        and wa.approved_phone = trim(p_destination_phone)
    ) into v_phone_ok;

    if not v_phone_ok then
      raise exception 'Destination phone is not authorized for withdrawals';
    end if;
  end if;

  -- Available balance check using live balances + active holds
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

  -- Insert payout request (pending)
  insert into public.external_payout_requests(
    domain,
    wallet_id,
    requested_by_user_id,
    amount,
    currency,
    destination_phone,
    status,
    reason_code
  ) values (
    'teketeke',
    p_wallet_id,
    v_uid,
    p_amount,
    'KES',
    trim(p_destination_phone),
    'pending',
    p_reason_code
  )
  returning id into v_req_id;

  return v_req_id;
end $$;

grant execute on function public.request_payout_strict(uuid, numeric, text, text) to authenticated;

-- Tighten RLS: block direct inserts; require RPC
drop policy if exists "payout_insert_allowed_roles" on public.external_payout_requests;

drop policy if exists "payout_no_client_insert" on public.external_payout_requests;
create policy "payout_no_client_insert"
on public.external_payout_requests
for insert
to authenticated
with check (false);
