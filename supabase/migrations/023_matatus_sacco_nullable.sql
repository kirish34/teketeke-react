-- 023_matatus_sacco_nullable.sql
-- Make sacco_id optional for matatus so Taxi and BodaBoda
-- vehicles can exist without being attached to a SACCO.

alter table if exists public.matatus
  alter column sacco_id drop not null;

-- Also relax the legacy matatus table used by the pooler helper schema.
alter table if exists matatus
  alter column sacco_id drop not null;

