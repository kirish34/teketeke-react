-- Payout safety hardening: guard wallet types, maker-checker, immutability, available-balance check, optional phone authorization, and RPC for payouts.

-- 1) Block payouts from matatu/clearing wallets
create or replace function public.guard_payout_wallet_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wtype public.wallet_type;
begin
  select wallet_type into wtype
  from public.wallets
  where id = new.wallet_id
    and domain = 'teketeke';

  if wtype in ('matatu','clearing') then
    raise exception 'Payouts are not allowed from % wallets', wtype;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_payout_wallet_type on public.external_payout_requests;
create trigger trg_guard_payout_wallet_type
before insert on public.external_payout_requests
for each row execute function public.guard_payout_wallet_type();

-- 2) Maker-checker: approver cannot equal requester
create or replace function public.guard_maker_checker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('approved','processing','paid') then
    if new.approved_by_user_id is null then
      raise exception 'approved_by_user_id is required for status %', new.status;
    end if;

    if new.approved_by_user_id = new.requested_by_user_id then
      raise exception 'Maker-checker violation: requester cannot approve their own payout';
    end if;

    if new.approved_at is null then
      new.approved_at := now();
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_maker_checker on public.external_payout_requests;
create trigger trg_guard_maker_checker
before update of status, approved_by_user_id on public.external_payout_requests
for each row execute function public.guard_maker_checker();

-- 3) Freeze amount/destination after approval
create or replace function public.guard_payout_immutable_after_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('approved','processing','paid') then
    if new.amount <> old.amount then
      raise exception 'Cannot change amount after approval';
    end if;

    if coalesce(new.destination_phone,'') <> coalesce(old.destination_phone,'') then
      raise exception 'Cannot change destination_phone after approval';
    end if;

    if coalesce(new.destination_account,'') <> coalesce(old.destination_account,'') then
      raise exception 'Cannot change destination_account after approval';
    end if;

    if coalesce(new.destination_bank,'') <> coalesce(old.destination_bank,'') then
      raise exception 'Cannot change destination_bank after approval';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_payout_immutable_after_approval on public.external_payout_requests;
create trigger trg_guard_payout_immutable_after_approval
before update on public.external_payout_requests
for each row execute function public.guard_payout_immutable_after_approval();

-- Provide a live balances view (alias) if not already present
drop view if exists public.wallet_balances_live;
create or replace view public.wallet_balances_live as
select * from public.wallet_balances_mv;

-- 4) Helpers for available balance check (uses live balances + holds)
create or replace function public.get_active_holds_sum(p_wallet_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(amount), 0)
  from public.wallet_holds
  where wallet_id = p_wallet_id
    and domain = 'teketeke'
    and status = 'active';
$$;

create or replace function public.get_wallet_balance_live(p_wallet_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(balance, 0)
  from public.wallet_balances_live
  where wallet_id = p_wallet_id;
$$;

-- Guard: available_balance >= payout amount
create or replace function public.guard_payout_sufficient_available()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bal numeric;
  held numeric;
  available numeric;
begin
  bal := public.get_wallet_balance_live(new.wallet_id);
  held := public.get_active_holds_sum(new.wallet_id);
  available := bal - held;

  if new.amount > available then
    raise exception 'Insufficient available balance. Available=%, requested=%', available, new.amount;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_payout_sufficient_available on public.external_payout_requests;
create trigger trg_guard_payout_sufficient_available
before insert on public.external_payout_requests
for each row execute function public.guard_payout_sufficient_available();

-- 5) Optional strict mode: owner wallet payouts only to authorized phones (toggle by keeping/removing this trigger)
create or replace function public.guard_owner_payout_phone_authorized()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wtype public.wallet_type;
  matatu_wallet uuid;
  ok boolean;
begin
  select wallet_type into wtype
  from public.wallets
  where id = new.wallet_id;

  -- enforce only for owner wallets
  if wtype <> 'owner' then
    return new;
  end if;

  select wl.to_wallet_id into matatu_wallet
  from public.wallet_links wl
  join public.wallets w_from on w_from.id = wl.from_wallet_id
  join public.wallets w_to   on w_to.id   = wl.to_wallet_id
  where wl.domain='teketeke'
    and wl.is_active=true
    and wl.link_type='owner_matatu'
    and wl.from_wallet_id = new.wallet_id
    and w_to.wallet_type='matatu'
  limit 1;

  if matatu_wallet is null then
    raise exception 'Owner wallet has no linked matatu wallet for phone authorization check';
  end if;

  select exists (
    select 1
    from public.withdrawal_authorizations wa
    where wa.domain='teketeke'
      and wa.matatu_wallet_id = matatu_wallet
      and wa.is_active=true
      and wa.approved_phone = new.destination_phone
  ) into ok;

  if not ok then
    raise exception 'Destination phone not authorized for withdrawals';
  end if;

  return new;
end $$;

-- Enable this trigger only if you want strict phone authorization
-- drop trigger if exists trg_guard_owner_payout_phone_authorized on public.external_payout_requests;
-- create trigger trg_guard_owner_payout_phone_authorized
-- before insert on public.external_payout_requests
-- for each row execute function public.guard_owner_payout_phone_authorized();

-- 6) Hardened RPC to request payout (use this instead of direct insert)
create or replace function public.request_payout(
  p_wallet_id uuid,
  p_amount numeric,
  p_destination_phone text,
  p_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  req_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be > 0';
  end if;

  if not public.has_wallet_role(p_wallet_id, array['owner','sacco_admin','super_admin']::public.member_role[]) then
    raise exception 'Not allowed to request payout for this wallet';
  end if;

  insert into public.external_payout_requests(
    domain, wallet_id, requested_by_user_id,
    amount, currency,
    destination_phone,
    status, reason_code
  ) values (
    'teketeke', p_wallet_id, auth.uid(),
    p_amount, 'KES',
    p_destination_phone,
    'pending', p_reason_code
  )
  returning id into req_id;

  return req_id;
end $$;
