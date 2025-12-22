-- 004_rls_tighten_reads.sql
-- Tighten public reads on saccos/matatus: require signed-in users

drop policy if exists "read saccos for all" on public.saccos;
drop policy if exists "read matatus for all" on public.matatus;

create policy "read saccos (signed in)"
on public.saccos for select
using ( auth.uid() is not null );

create policy "read matatus (signed in)"
on public.matatus for select
using ( auth.uid() is not null );

