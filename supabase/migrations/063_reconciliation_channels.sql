-- 063_reconciliation_channels.sql
-- Split reconciliation rollups by channel (C2B vs STK)

create table if not exists public.reconciliation_daily_channels (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  channel text not null,
  paybill_number text null,
  credited_total numeric not null default 0,
  credited_count int not null default 0,
  quarantined_total numeric not null default 0,
  quarantined_count int not null default 0,
  rejected_total numeric not null default 0,
  rejected_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.reconciliation_daily_channels
    add constraint reconciliation_daily_channels_channel_check
    check (channel in ('C2B','STK'));
exception when duplicate_object or duplicate_table then null; end $$;

create unique index if not exists reconciliation_daily_channels_date_channel_key
  on public.reconciliation_daily_channels(date, channel);

create index if not exists reconciliation_daily_channels_date_idx
  on public.reconciliation_daily_channels(date);

drop trigger if exists reconciliation_daily_channels_set_updated_at on public.reconciliation_daily_channels;
create trigger reconciliation_daily_channels_set_updated_at
before update on public.reconciliation_daily_channels
for each row execute function public.set_updated_at();

alter table public.reconciliation_daily_channels enable row level security;
drop policy if exists "recon_channels_no_client_access" on public.reconciliation_daily_channels;
create policy "recon_channels_no_client_access"
on public.reconciliation_daily_channels
for all
to authenticated
using (false)
with check (false);
