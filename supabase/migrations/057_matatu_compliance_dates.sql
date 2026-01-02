-- Add matatu compliance dates for owner-managed updates.
alter table if exists public.matatus
  add column if not exists insurance_expiry_date date,
  add column if not exists inspection_expiry_date date;
