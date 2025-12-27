-- 045_sms_settings.sql
-- SMS templates, messages, and settings for system-admin control.

create table if not exists public.sms_templates (
  code text primary key,
  label text,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.sms_templates
  add column if not exists label text,
  add column if not exists body text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.sms_templates set
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where created_at is null or updated_at is null;

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null,
  template_code text references public.sms_templates(code),
  body text not null,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING',
  provider_message_id text,
  error_message text,
  tries int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sms_messages_status on public.sms_messages(status);
create index if not exists idx_sms_messages_created_at on public.sms_messages(created_at desc);

alter table if exists public.sms_messages
  add column if not exists to_phone text,
  add column if not exists template_code text references public.sms_templates(code),
  add column if not exists body text,
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'PENDING',
  add column if not exists provider_message_id text,
  add column if not exists error_message text,
  add column if not exists tries int not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.sms_messages set
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  status = coalesce(status, 'PENDING'),
  tries = coalesce(tries, 0),
  meta = coalesce(meta, '{}'::jsonb)
where created_at is null
  or updated_at is null
  or status is null
  or tries is null
  or meta is null;

create table if not exists public.sms_settings (
  id int primary key default 1,
  sender_id text,
  quiet_hours_start text,
  quiet_hours_end text,
  fee_paid_enabled boolean not null default false,
  fee_failed_enabled boolean not null default true,
  balance_enabled boolean not null default true,
  eod_enabled boolean not null default true,
  payout_paid_enabled boolean not null default false,
  payout_failed_enabled boolean not null default true,
  savings_paid_enabled boolean not null default false,
  savings_balance_enabled boolean not null default true,
  loan_paid_enabled boolean not null default false,
  loan_failed_enabled boolean not null default true,
  loan_balance_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table if exists public.sms_settings
  add column if not exists sender_id text,
  add column if not exists quiet_hours_start text,
  add column if not exists quiet_hours_end text,
  add column if not exists fee_paid_enabled boolean not null default false,
  add column if not exists fee_failed_enabled boolean not null default true,
  add column if not exists balance_enabled boolean not null default true,
  add column if not exists eod_enabled boolean not null default true,
  add column if not exists payout_paid_enabled boolean not null default false,
  add column if not exists payout_failed_enabled boolean not null default true,
  add column if not exists savings_paid_enabled boolean not null default false,
  add column if not exists savings_balance_enabled boolean not null default true,
  add column if not exists loan_paid_enabled boolean not null default false,
  add column if not exists loan_failed_enabled boolean not null default true,
  add column if not exists loan_balance_enabled boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.sms_settings set
  updated_at = coalesce(updated_at, now())
where updated_at is null;

insert into public.sms_settings (id)
values (1)
on conflict (id) do nothing;

insert into public.sms_templates (code, label, body, is_active)
values
  ('fee_paid', 'Daily fee paid', 'TEKETEKE: Daily fee KES {{amount}} paid for {{plate}}. Ref {{ref}}. Bal {{balance}}.', true),
  ('fee_failed', 'Daily fee failed', 'TEKETEKE: Daily fee FAILED for {{plate}} KES {{amount}}. Reason {{reason}}. PayBill 4814003 Acc {{plate}}.', true),
  ('balance_request', 'Balance request', 'TEKETEKE: {{plate}} Bal KES {{balance}}. Avail {{available}}. {{date}}.', true),
  ('eod_summary', 'End of day summary', 'TEKETEKE EOD {{plate}}: In {{collected}}, Fee {{fee}}, Sav {{savings}}, Loan {{loan_paid}}, Paid {{payout}}, Bal {{balance}}. {{date}}.', true),
  ('payout_paid', 'Payout paid', 'TEKETEKE: Payout sent {{plate}} KES {{amount}} to {{phone}}. Ref {{ref}}. Bal {{balance}}.', true),
  ('payout_failed', 'Payout failed', 'TEKETEKE: Payout delayed {{plate}} KES {{amount}}. Reason {{reason}}. Ref {{ref}}.', true),
  ('savings_paid', 'Savings paid', 'TEKETEKE: {{plate}} savings KES {{amount}} received. Total {{savings_balance}}.', true),
  ('savings_balance', 'Savings balance', 'TEKETEKE: {{plate}} savings balance KES {{savings_balance}}. {{date}}.', true),
  ('loan_paid', 'Loan paid', 'TEKETEKE: {{plate}} loan paid KES {{amount}}. Balance {{loan_balance}}.', true),
  ('loan_failed', 'Loan failed', 'TEKETEKE: Loan payment FAILED {{plate}} KES {{amount}}. Reason {{reason}}. PayBill 4814003 Acc {{plate}}.', true),
  ('loan_balance', 'Loan balance', 'TEKETEKE: {{plate}} loan balance KES {{loan_balance}}. Next due {{next_due}}.', true)
on conflict (code) do nothing;
