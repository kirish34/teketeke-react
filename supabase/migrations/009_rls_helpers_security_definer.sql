-- 009_rls_helpers_security_definer.sql
-- Fix RLS helper recursion by running helper functions as SECURITY DEFINER
-- so they evaluate without triggering policies on the same tables.

set check_function_bodies = off;

-- Ensure functions run with stable search_path to avoid hijacking
create or replace function public.is_system_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = uid and role = 'SYSTEM_ADMIN'
  );
$$;

create or replace function public.is_sacco_admin(uid uuid, sid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = uid and role = 'SACCO_ADMIN' and sacco_id = sid
  );
$$;

create or replace function public.is_staff(uid uuid, sid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = uid and sacco_id = sid
  );
$$;

