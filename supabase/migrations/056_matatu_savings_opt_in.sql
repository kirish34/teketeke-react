-- Add per-matatu savings opt-in flag.
alter table if exists public.matatus
  add column if not exists savings_opt_in boolean not null default false;

update public.matatus
  set savings_opt_in = false
  where savings_opt_in is null;
