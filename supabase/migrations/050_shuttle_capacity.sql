-- 050_shuttle_capacity.sql
alter table public.shuttles
  add column if not exists vehicle_type text,
  add column if not exists vehicle_type_other text,
  add column if not exists seat_capacity int,
  add column if not exists load_capacity_kg int;

update public.shuttles
set vehicle_type = 'MINIBUS'
where vehicle_type is null;

alter table public.shuttles
  alter column vehicle_type set default 'MINIBUS';

alter table public.shuttles
  alter column vehicle_type set not null;
