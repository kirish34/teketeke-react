-- 080_system_admin_profile_fields.sql
-- Add profile fields to system_admin_permissions for admin registry.

alter table if exists public.system_admin_permissions
  add column if not exists full_name text,
  add column if not exists id_number text,
  add column if not exists phone text;
