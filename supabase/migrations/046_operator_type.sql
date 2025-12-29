-- Add operator type to saccos for multi-operator dashboards
alter table if exists public.saccos
  add column if not exists org_type text default 'MATATU_SACCO';

update public.saccos
  set org_type = 'MATATU_SACCO'
  where org_type is null;
