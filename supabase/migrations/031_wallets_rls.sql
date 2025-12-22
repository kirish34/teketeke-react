-- Enable RLS on all wallet tables
alter table public.wallets enable row level security;
alter table public.wallet_links enable row level security;
alter table public.wallet_members enable row level security;
alter table public.withdrawal_authorizations enable row level security;
alter table public.automation_rules enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.external_payout_requests enable row level security;
alter table public.mpesa_c2b_payments enable row level security;
alter table public.unmatched_payments enable row level security;

-- Helper functions
create or replace function public.is_wallet_member(wid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1
    from public.wallet_members wm
    where wm.wallet_id = wid
      and wm.user_id = auth.uid()
      and wm.domain = 'teketeke'
  );
$$;

create or replace function public.has_wallet_role(wid uuid, roles public.member_role[])
returns boolean language sql stable as $$
  select exists (
    select 1
    from public.wallet_members wm
    where wm.wallet_id = wid
      and wm.user_id = auth.uid()
      and wm.role = any(roles)
      and wm.domain = 'teketeke'
  );
$$;

create or replace function public.can_spend_wallet(wid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1
    from public.wallet_members wm
    where wm.wallet_id = wid
      and wm.user_id = auth.uid()
      and wm.can_spend = true
      and wm.domain = 'teketeke'
  );
$$;

-- wallets: read for members, no client writes
drop policy if exists "wallets_select_member" on public.wallets;
create policy "wallets_select_member"
on public.wallets
for select
to authenticated
using (
  domain = 'teketeke'
  and public.is_wallet_member(id)
);

drop policy if exists "wallets_no_client_write" on public.wallets;
create policy "wallets_no_client_write"
on public.wallets
for all
to authenticated
using (false)
with check (false);

-- wallet_members: members can view; owner/super_admin manage
drop policy if exists "wallet_members_select_same_wallet" on public.wallet_members;
create policy "wallet_members_select_same_wallet"
on public.wallet_members
for select
to authenticated
using (
  domain = 'teketeke'
  and public.is_wallet_member(wallet_id)
);

drop policy if exists "wallet_members_manage_owner_or_super" on public.wallet_members;
create policy "wallet_members_manage_owner_or_super"
on public.wallet_members
for insert
to authenticated
with check (
  domain = 'teketeke'
  and public.has_wallet_role(wallet_id, array['owner','super_admin']::public.member_role[])
);

drop policy if exists "wallet_members_update_owner_or_super" on public.wallet_members;
create policy "wallet_members_update_owner_or_super"
on public.wallet_members
for update
to authenticated
using (
  domain = 'teketeke'
  and public.has_wallet_role(wallet_id, array['owner','super_admin']::public.member_role[])
)
with check (
  domain = 'teketeke'
  and public.has_wallet_role(wallet_id, array['owner','super_admin']::public.member_role[])
);

drop policy if exists "wallet_members_delete_owner_or_super" on public.wallet_members;
create policy "wallet_members_delete_owner_or_super"
on public.wallet_members
for delete
to authenticated
using (
  domain = 'teketeke'
  and public.has_wallet_role(wallet_id, array['owner','super_admin']::public.member_role[])
);

-- withdrawal_authorizations: owner only
drop policy if exists "withdraw_auth_select_owner_only" on public.withdrawal_authorizations;
create policy "withdraw_auth_select_owner_only"
on public.withdrawal_authorizations
for select
to authenticated
using (
  domain = 'teketeke'
  and public.has_wallet_role(matatu_wallet_id, array['owner','super_admin']::public.member_role[])
);

drop policy if exists "withdraw_auth_insert_owner_only" on public.withdrawal_authorizations;
create policy "withdraw_auth_insert_owner_only"
on public.withdrawal_authorizations
for insert
to authenticated
with check (
  domain = 'teketeke'
  and public.has_wallet_role(matatu_wallet_id, array['owner','super_admin']::public.member_role[])
  and approved_by_user_id = auth.uid()
);

drop policy if exists "withdraw_auth_update_owner_only" on public.withdrawal_authorizations;
create policy "withdraw_auth_update_owner_only"
on public.withdrawal_authorizations
for update
to authenticated
using (
  domain = 'teketeke'
  and public.has_wallet_role(matatu_wallet_id, array['owner','super_admin']::public.member_role[])
)
with check (
  domain = 'teketeke'
  and public.has_wallet_role(matatu_wallet_id, array['owner','super_admin']::public.member_role[])
);

drop policy if exists "withdraw_auth_delete_owner_only" on public.withdrawal_authorizations;
create policy "withdraw_auth_delete_owner_only"
on public.withdrawal_authorizations
for delete
to authenticated
using (
  domain = 'teketeke'
  and public.has_wallet_role(matatu_wallet_id, array['owner','super_admin']::public.member_role[])
);

-- automation_rules: members view, owner edits
drop policy if exists "automation_select_wallet_members" on public.automation_rules;
create policy "automation_select_wallet_members"
on public.automation_rules
for select
to authenticated
using (
  domain = 'teketeke'
  and public.is_wallet_member(source_wallet_id)
);

drop policy if exists "automation_insert_owner_only" on public.automation_rules;
create policy "automation_insert_owner_only"
on public.automation_rules
for insert
to authenticated
with check (
  domain = 'teketeke'
  and public.has_wallet_role(source_wallet_id, array['owner','super_admin']::public.member_role[])
  and created_by_user_id = auth.uid()
);

drop policy if exists "automation_update_owner_only" on public.automation_rules;
create policy "automation_update_owner_only"
on public.automation_rules
for update
to authenticated
using (
  domain = 'teketeke'
  and public.has_wallet_role(source_wallet_id, array['owner','super_admin']::public.member_role[])
)
with check (
  domain = 'teketeke'
  and public.has_wallet_role(source_wallet_id, array['owner','super_admin']::public.member_role[])
);

drop policy if exists "automation_delete_owner_only" on public.automation_rules;
create policy "automation_delete_owner_only"
on public.automation_rules
for delete
to authenticated
using (
  domain = 'teketeke'
  and public.has_wallet_role(source_wallet_id, array['owner','super_admin']::public.member_role[])
);

-- ledger_entries: view-only for participants, no client writes
drop policy if exists "ledger_select_wallet_participant" on public.ledger_entries;
create policy "ledger_select_wallet_participant"
on public.ledger_entries
for select
to authenticated
using (
  domain = 'teketeke'
  and (
    (from_wallet_id is not null and public.is_wallet_member(from_wallet_id))
    or
    (to_wallet_id is not null and public.is_wallet_member(to_wallet_id))
  )
);

drop policy if exists "ledger_no_client_write" on public.ledger_entries;
create policy "ledger_no_client_write"
on public.ledger_entries
for all
to authenticated
using (false)
with check (false);

-- external_payout_requests: members view; owner/sacco_admin/super can request; approvals allowed
drop policy if exists "payout_select_wallet_members" on public.external_payout_requests;
create policy "payout_select_wallet_members"
on public.external_payout_requests
for select
to authenticated
using (
  domain = 'teketeke'
  and public.is_wallet_member(wallet_id)
);

drop policy if exists "payout_insert_allowed_roles" on public.external_payout_requests;
create policy "payout_insert_allowed_roles"
on public.external_payout_requests
for insert
to authenticated
with check (
  domain = 'teketeke'
  and requested_by_user_id = auth.uid()
  and public.has_wallet_role(wallet_id, array['owner','sacco_admin','super_admin']::public.member_role[])
);

drop policy if exists "payout_update_approval_roles" on public.external_payout_requests;
create policy "payout_update_approval_roles"
on public.external_payout_requests
for update
to authenticated
using (
  domain = 'teketeke'
  and (
    public.has_wallet_role(wallet_id, array['sacco_admin','super_admin']::public.member_role[])
    or (requested_by_user_id = auth.uid() and status = 'pending')
  )
)
with check (
  domain = 'teketeke'
  and (
    public.has_wallet_role(wallet_id, array['sacco_admin','super_admin']::public.member_role[])
    or (requested_by_user_id = auth.uid() and status in ('pending','cancelled'))
  )
);

-- mpesa_c2b_payments & unmatched_payments: no client access (service role only)
drop policy if exists "c2b_no_client_access" on public.mpesa_c2b_payments;
create policy "c2b_no_client_access"
on public.mpesa_c2b_payments
for all
to authenticated
using (false)
with check (false);

drop policy if exists "unmatched_no_client_access" on public.unmatched_payments;
create policy "unmatched_no_client_access"
on public.unmatched_payments
for all
to authenticated
using (false)
with check (false);

-- wallet_links: members can view, no client writes
drop policy if exists "wallet_links_select_members" on public.wallet_links;
create policy "wallet_links_select_members"
on public.wallet_links
for select
to authenticated
using (
  domain = 'teketeke'
  and (public.is_wallet_member(from_wallet_id) or public.is_wallet_member(to_wallet_id))
);

drop policy if exists "wallet_links_no_client_write" on public.wallet_links;
create policy "wallet_links_no_client_write"
on public.wallet_links
for all
to authenticated
using (false)
with check (false);
