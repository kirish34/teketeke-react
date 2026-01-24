-- 071_mpesa_stk_requests.sql
-- STK intake table + supporting indexes; complements wallet_ledger idempotency.

-- Idempotency guards (ensure in place even if prior migration missed)
create unique index if not exists wallet_ledger_reference_uq
  on public.wallet_ledger(reference_type, reference_id)
  where reference_type is not null and reference_id is not null;

create unique index if not exists wallet_ledger_provider_ref_uq
  on public.wallet_ledger(provider, provider_ref)
  where provider is not null and provider_ref is not null;

-- STK intake table
create table if not exists public.mpesa_stk_requests (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'teketeke',
  wallet_id uuid null references public.wallets(id) on delete set null,
  wallet_code text null,
  account_reference text null,
  amount numeric(14,2) not null check (amount > 0),
  msisdn text null,
  msisdn_normalized text null,
  display_msisdn text null,
  msisdn_source text null,
  checkout_request_id text null,
  merchant_request_id text null,
  provider_receipt text null,
  status text not null default 'PENDING',
  error text null,
  raw_request jsonb not null default '{}'::jsonb,
  raw_callback jsonb not null default '{}'::jsonb,
  credited_ledger_id uuid null references public.wallet_ledger(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(checkout_request_id)
);

-- status helper (simple text to avoid enum churn)
create index if not exists mpesa_stk_requests_status_idx on public.mpesa_stk_requests(status);
create index if not exists mpesa_stk_requests_checkout_idx on public.mpesa_stk_requests(checkout_request_id);

-- updated_at trigger
do $$ begin
  create trigger mpesa_stk_requests_set_updated_at
  before update on public.mpesa_stk_requests
  for each row
  execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
