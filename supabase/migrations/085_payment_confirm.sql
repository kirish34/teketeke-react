-- 085_payment_confirm.sql
-- Add confirmation fields to payment intake tables for staff confirm flow.

-- mpesa c2b payments
alter table if exists public.mpesa_c2b_payments
  add column if not exists confirmed_at timestamptz null,
  add column if not exists confirmed_by uuid null,
  add column if not exists confirmed_shift_id uuid null;

create index if not exists idx_mpesa_c2b_confirmed_at on public.mpesa_c2b_payments(confirmed_at);
create index if not exists idx_mpesa_c2b_confirmed_shift on public.mpesa_c2b_payments(confirmed_shift_id);

-- mpesa stk payments (optional)
alter table if exists public.mpesa_stk_payments
  add column if not exists confirmed_at timestamptz null,
  add column if not exists confirmed_by uuid null,
  add column if not exists confirmed_shift_id uuid null;

create index if not exists idx_mpesa_stk_confirmed_at on public.mpesa_stk_payments(confirmed_at);

-- optional FKs (best-effort)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='matatu_shifts') then
    alter table public.mpesa_c2b_payments
      add constraint mpesa_c2b_payments_confirmed_shift_fkey
      foreign key (confirmed_shift_id) references public.matatu_shifts(id) on delete set null;
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='mpesa_stk_payments') then
    alter table public.mpesa_stk_payments
      add constraint mpesa_stk_payments_confirmed_shift_fkey
      foreign key (confirmed_shift_id) references public.matatu_shifts(id) on delete set null;
  end if;
exception when duplicate_object then null;
end $$;
