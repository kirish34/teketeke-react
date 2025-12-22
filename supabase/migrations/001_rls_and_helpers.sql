
-- 001_rls_and_helpers.sql

-- Helper functions
create or replace function public.is_system_admin(uid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = uid and role = 'SYSTEM_ADMIN'
  );
$$;

create or replace function public.is_sacco_admin(uid uuid, sid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = uid and role = 'SACCO_ADMIN' and sacco_id = sid
  );
$$;

create or replace function public.is_staff(uid uuid, sid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = uid and sacco_id = sid
  );
$$;

-- Today counts
create or replace function public.count_tx_today()
returns int language sql stable as $$
  select count(*)::int from public.transactions
  where created_at::date = now()::date;
$$;

create or replace function public.fees_today()
returns table(date text, sacco uuid, amount numeric, matatu uuid, "time" text) language sql stable as $$
  select to_char(now(),'YYYY-MM-DD') as date, t.sacco_id as sacco, t.fare_amount_kes as amount, t.matatu_id as matatu, to_char(t.created_at,'HH24:MI:SS') as "time"
  from public.transactions t
  where t.kind='SACCO_FEE' and t.created_at::date = now()::date
  order by t.created_at desc;
$$;

create or replace function public.loans_today()
returns table(date text, sacco uuid, amount numeric, matatu uuid, "time" text) language sql stable as $$
  select to_char(now(),'YYYY-MM-DD') as date, t.sacco_id as sacco, t.fare_amount_kes as amount, t.matatu_id as matatu, to_char(t.created_at,'HH24:MI:SS') as "time"
  from public.transactions t
  where t.kind='LOAN_REPAY' and t.created_at::date = now()::date
  order by t.created_at desc;
$$;

-- Enable RLS
alter table public.saccos enable row level security;
alter table public.matatus enable row level security;
alter table public.transactions enable row level security;
alter table public.loans enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.ussd_pool enable row level security;

-- Policies
-- For now: read for all authenticated; writes restricted.
create policy "read saccos for all" on public.saccos for select using (true);
create policy "insert saccos system only" on public.saccos for insert with check ( is_system_admin(auth.uid()) );
create policy "update saccos admins" on public.saccos for update using ( is_system_admin(auth.uid()) or is_sacco_admin(auth.uid(), id) );
create policy "delete saccos system only" on public.saccos for delete using ( is_system_admin(auth.uid()) );

create policy "read matatus for all" on public.matatus for select using (true);
create policy "insert matatus admins" on public.matatus for insert with check ( is_system_admin(auth.uid()) or is_sacco_admin(auth.uid(), sacco_id) );
create policy "update matatus admins" on public.matatus for update using ( is_system_admin(auth.uid()) or is_sacco_admin(auth.uid(), sacco_id) );
create policy "delete matatus admins" on public.matatus for delete using ( is_system_admin(auth.uid()) or is_sacco_admin(auth.uid(), sacco_id) );

create policy "read tx for staff of sacco" on public.transactions for select using ( is_system_admin(auth.uid()) or is_staff(auth.uid(), sacco_id) );
create policy "insert tx staff/admins" on public.transactions for insert with check ( is_system_admin(auth.uid()) or is_staff(auth.uid(), sacco_id) );
create policy "update tx system only" on public.transactions for update using ( is_system_admin(auth.uid()) );
create policy "delete tx system only" on public.transactions for delete using ( is_system_admin(auth.uid()) );

create policy "read loans for staff of sacco" on public.loans for select using ( is_system_admin(auth.uid()) or is_staff(auth.uid(), sacco_id) );
create policy "insert loans admins" on public.loans for insert with check ( is_system_admin(auth.uid()) or is_sacco_admin(auth.uid(), sacco_id) );
create policy "update loans admins" on public.loans for update using ( is_system_admin(auth.uid()) or is_sacco_admin(auth.uid(), sacco_id) );
create policy "delete loans system only" on public.loans for delete using ( is_system_admin(auth.uid()) );

create policy "read staff profiles system or sacco admin/staff" on public.staff_profiles for select using ( is_system_admin(auth.uid()) or is_staff(auth.uid(), coalesce(sacco_id, uuid_nil())) );
create policy "insert staff system or sacco admin" on public.staff_profiles for insert with check ( is_system_admin(auth.uid()) or is_sacco_admin(auth.uid(), sacco_id) );
create policy "update staff system or sacco admin" on public.staff_profiles for update using ( is_system_admin(auth.uid()) or is_sacco_admin(auth.uid(), sacco_id) );
create policy "delete staff system only" on public.staff_profiles for delete using ( is_system_admin(auth.uid()) );

create policy "read ussd for system or sacco admins" on public.ussd_pool for select using ( is_system_admin(auth.uid()) or exists(select 1 from saccos) );
create policy "write ussd system only" on public.ussd_pool for all using ( is_system_admin(auth.uid()) ) with check ( is_system_admin(auth.uid()) );
