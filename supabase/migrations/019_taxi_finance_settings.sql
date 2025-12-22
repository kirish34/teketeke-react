-- 019_taxi_finance_settings.sql
-- Per-user finance settings for Taxi console (savings target, etc.)

create table if not exists public.taxi_finance_settings (
  user_id uuid primary key,
  monthly_savings_target_kes numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_taxi_finance_settings_user on public.taxi_finance_settings(user_id);

alter table public.taxi_finance_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'taxi_finance_settings'
      and policyname = 'taxi_finance_settings_select_own'
  ) then
    create policy "taxi_finance_settings_select_own"
      on public.taxi_finance_settings
      for select
      using ( user_id = auth.uid() );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'taxi_finance_settings'
      and policyname = 'taxi_finance_settings_upsert_own'
  ) then
    create policy "taxi_finance_settings_upsert_own"
      on public.taxi_finance_settings
      for all
      using ( user_id = auth.uid() )
      with check ( user_id = auth.uid() );
  end if;
end
$$;

