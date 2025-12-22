-- Role check helpers for frontend gating

create or replace function public.me_is_admin_for_teketeke()
returns boolean
language sql
security definer
as $$
  select exists (
    select 1
    from public.wallet_members wm
    join public.wallets w on w.id = wm.wallet_id
    where w.domain = 'teketeke'
      and wm.user_id = auth.uid()
      and wm.role in ('sacco_admin','super_admin')
      and w.is_active = true
  );
$$;

grant execute on function public.me_is_admin_for_teketeke() to authenticated;

create or replace function public.me_is_owner_for_teketeke()
returns boolean
language sql
security definer
as $$
  select exists (
    select 1
    from public.wallet_members wm
    join public.wallets w on w.id = wm.wallet_id
    where w.domain = 'teketeke'
      and wm.user_id = auth.uid()
      and wm.role in ('owner','super_admin')
      and w.is_active = true
  );
$$;

grant execute on function public.me_is_owner_for_teketeke() to authenticated;
