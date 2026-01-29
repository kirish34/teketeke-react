-- 083_wallet_ledger_trip_id.sql
-- Tag wallet ledger (and intake tables) with trip_id for current active trips.

alter table if exists public.wallet_ledger
  add column if not exists trip_id uuid null;

create index if not exists idx_wallet_ledger_trip_id on public.wallet_ledger(trip_id);
create index if not exists idx_wallet_ledger_wallet_trip on public.wallet_ledger(wallet_id, trip_id);

-- Optional FK if matatu_trips exists; ignore errors if table missing.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'matatu_trips') then
    alter table public.wallet_ledger
      add constraint wallet_ledger_trip_id_fkey
      foreign key (trip_id) references public.matatu_trips(id) on delete set null;
  end if;
exception when duplicate_object then
  null;
end $$;

-- Also tag raw mpesa tables if present
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mpesa_c2b_payments') then
    alter table public.mpesa_c2b_payments add column if not exists trip_id uuid null;
    create index if not exists idx_mpesa_c2b_trip on public.mpesa_c2b_payments(trip_id);
  end if;
exception when others then
  null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mpesa_stk_payments') then
    alter table public.mpesa_stk_payments add column if not exists trip_id uuid null;
    create index if not exists idx_mpesa_stk_trip on public.mpesa_stk_payments(trip_id);
  end if;
exception when others then
  null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mpesa_stk_requests') then
    alter table public.mpesa_stk_requests add column if not exists trip_id uuid null;
    create index if not exists idx_mpesa_stk_requests_trip on public.mpesa_stk_requests(trip_id);
  end if;
exception when others then
  null;
end $$;
