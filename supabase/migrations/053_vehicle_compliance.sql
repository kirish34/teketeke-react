-- 053_vehicle_compliance.sql
alter table if exists public.shuttles
  add column if not exists tlb_expiry_date date;

alter table if exists public.shuttles
  add column if not exists insurance_expiry_date date;

alter table if exists public.shuttles
  add column if not exists inspection_expiry_date date;

alter table if exists public.taxis
  add column if not exists insurance_expiry_date date;

alter table if exists public.taxis
  add column if not exists psv_badge_expiry_date date;

alter table if exists public.boda_bikes
  add column if not exists insurance_expiry_date date;

alter table if exists public.boda_riders
  add column if not exists license_expiry_date date;
