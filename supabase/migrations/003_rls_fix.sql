-- 003_rlS_fix.sql
-- Restrict USSD pool read policy to system admins only.

drop policy if exists "read ussd for system or sacco admins" on public.ussd_pool;

create policy "read ussd for admins"
on public.ussd_pool for select
using ( is_system_admin(auth.uid()) );

