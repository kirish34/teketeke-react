-- 065_paybill_prefix_subtype_counters.sql
-- Paybill prefix/subtype counters + wallet kind support.

create table if not exists public.paybill_code_counters (
  key text primary key,
  prefix_digit int not null,
  subtype_digit int not null,
  next_seq int not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.paybill_code_counters (key, prefix_digit, subtype_digit, next_seq)
values
  ('30', 3, 0, 1),
  ('31', 3, 1, 1),
  ('32', 3, 2, 1),
  ('10', 1, 0, 1),
  ('11', 1, 1, 1),
  ('40', 4, 0, 1),
  ('50', 5, 0, 1)
on conflict (key) do nothing;

alter table if exists public.wallets
  add column if not exists wallet_kind text;

alter table if exists public.boda_bikes
  add column if not exists wallet_id uuid references public.wallets(id);

create index if not exists boda_bikes_wallet_idx on public.boda_bikes(wallet_id);
