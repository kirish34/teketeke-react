-- Operator registration fields for multi-operator support
alter table if exists public.saccos
  add column if not exists operator_type text default 'MATATU_SACCO',
  add column if not exists display_name text,
  add column if not exists legal_name text,
  add column if not exists registration_no text,
  add column if not exists fee_label text default 'Daily Fee',
  add column if not exists savings_enabled boolean default true,
  add column if not exists loans_enabled boolean default true,
  add column if not exists routes_enabled boolean default true,
  add column if not exists status text default 'ACTIVE';

update public.saccos
set operator_type = coalesce(operator_type, 'MATATU_SACCO'),
    display_name = coalesce(display_name, name),
    fee_label = coalesce(fee_label, 'Daily Fee'),
    savings_enabled = coalesce(savings_enabled, true),
    loans_enabled = coalesce(loans_enabled, true),
    routes_enabled = coalesce(routes_enabled, true),
    status = coalesce(status, 'ACTIVE');

update public.saccos
set org_type = coalesce(org_type, operator_type, 'MATATU_SACCO')
where org_type is null;
