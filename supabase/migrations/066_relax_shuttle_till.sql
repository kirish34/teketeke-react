-- Allow shuttles.till_number to be nullable (platform provides settlement till)
alter table if exists public.shuttles
  alter column till_number drop not null;
