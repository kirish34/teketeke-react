-- 079_system_admin_permissions_audit.sql
-- Track who created/updated system admin permissions for audit visibility.

alter table if exists public.system_admin_permissions
  add column if not exists created_by uuid,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid,
  add column if not exists updated_by_email text;
