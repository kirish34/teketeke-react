
-- 002_seeds.sql
insert into public.saccos (name, contact_name, contact_phone, contact_email, default_till)
values
  ('CityRiders','Asha','0700000000','asha@example.com','123456'),
  ('MetroMove','Brian','0711000000','brian@example.com','654321')
on conflict do nothing;

insert into public.matatus (sacco_id, number_plate, owner_name, owner_phone, vehicle_type, tlb_number, till_number)
select id, 'KDA123A', 'Owner 1','0712345670','14-seater','TLB-1','999990' from public.saccos order by created_at asc limit 1
on conflict (number_plate) do nothing;
insert into public.matatus (sacco_id, number_plate, owner_name, owner_phone, vehicle_type, tlb_number, till_number)
select id, 'KDB456B', 'Owner 2','0712345671','14-seater','TLB-2','999991' from public.saccos order by created_at desc limit 1
on conflict (number_plate) do nothing;

-- USSD pool
do $$
declare i int;
begin
  for i in 1101..1130 loop
    insert into public.ussd_pool(base, checksum, full_code, status)
    values (i::text, (i % 9), '*001*' || i::text || (i % 9)::text || '#', 'AVAILABLE')
    on conflict do nothing;
  end loop;
end $$;
