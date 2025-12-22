do $$
begin
  if not exists (select 1 from pg_type t join pg_enum e on t.oid = e.enumtypid where t.typname = 'user_role' and e.enumlabel = 'STAFF') then
    alter type public.user_role add value 'STAFF';
  end if;
  if not exists (select 1 from pg_type t join pg_enum e on t.oid = e.enumtypid where t.typname = 'user_role' and e.enumlabel = 'DRIVER') then
    alter type public.user_role add value 'DRIVER';
  end if;
  if not exists (select 1 from pg_type t join pg_enum e on t.oid = e.enumtypid where t.typname = 'user_role' and e.enumlabel = 'MATATU_STAFF') then
    alter type public.user_role add value 'MATATU_STAFF';
  end if;
end;
$$;
