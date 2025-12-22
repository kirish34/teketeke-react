-- Wallets table: one row = one wallet (matatu / sacco / system)
create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),

  entity_type text not null, -- e.g. 'MATATU', 'SACCO', 'SYSTEM'
  entity_id uuid, -- link to matatu/sacco table when applicable (nullable for SYSTEM wallet)
  virtual_account_code text unique, -- K2-style virtual account code, e.g. 'MAT0021'

  balance numeric(14,2) not null default 0, -- current balance in KES
  currency text not null default 'KES',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wallets_entity_idx on wallets(entity_type, entity_id);
create index if not exists wallets_virtual_idx on wallets(virtual_account_code);


-- Wallet transactions: full history / audit log
create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),

  wallet_id uuid not null references wallets(id) on delete cascade,

  -- 'CREDIT' (money in), 'DEBIT' (money out), 'FEE', 'ADJUSTMENT'
  tx_type text not null,

  amount numeric(14,2) not null check (amount > 0),

  -- snapshot balances for audit
  balance_before numeric(14,2) not null,
  balance_after  numeric(14,2) not null,

  -- where did this come from?
  source text,        -- e.g. 'MPESA_STK', 'WITHDRAWAL', 'SACCO_FEE'
  source_ref text,    -- e.g. mpesa receipt, withdrawal id, etc.

  description text,

  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_wallet_idx
on wallet_transactions(wallet_id);

create index if not exists wallet_transactions_source_idx
on wallet_transactions(source, source_ref);


-- Raw MPesa callbacks (C2B/STK)
create table if not exists paybill_payments_raw (
  id bigserial primary key,

  mpesa_receipt text,     -- e.g. 'QDT45XYZ12'
  phone_number text,
  amount numeric(14,2),
  paybill_number text,
  account_reference text, -- the field you'll use to map to a wallet (virtual_account_code)

  transaction_timestamp timestamptz,

  raw_payload jsonb not null, -- full callback JSON

  processed boolean not null default false,
  processed_at timestamptz
);

create index if not exists paybill_payments_raw_ref_idx
on paybill_payments_raw(account_reference);

create index if not exists paybill_payments_raw_processed_idx
on paybill_payments_raw(processed);


-- Withdrawals: wallet -> MPesa B2C
create table if not exists withdrawals (
  id uuid primary key default gen_random_uuid(),

  wallet_id uuid not null references wallets(id) on delete cascade,

  amount numeric(14,2) not null check (amount > 0),

  -- phone to receive money (owner line)
  phone_number text not null,

  status text not null default 'PENDING', 
  -- allowed: 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'

  failure_reason text,

  mpesa_conversation_id text,
  mpesa_transaction_id text,

  mpesa_response jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists withdrawals_wallet_idx on withdrawals(wallet_id);
create index if not exists withdrawals_status_idx on withdrawals(status);


-- Fees configuration
create table if not exists fees_config (
  id uuid primary key default gen_random_uuid(),

  name text not null, -- e.g. 'DEFAULT_SACCO_FEE', 'TEKETEKE_PLATFORM_FEE'

  -- where this fee applies
  applies_to text not null, 
  -- e.g. 'MATATU_FARE', 'WITHDRAWAL'

  -- percentage or flat
  fee_type text not null, 
  -- 'PERCENT', 'FLAT'

  fee_value numeric(10,4) not null, -- e.g. 0.02 = 2%, or 10.00 = 10 KES

  -- who gets this fee
  beneficiary_type text not null,  -- 'SACCO', 'SYSTEM'
  beneficiary_wallet_id uuid,      -- can point directly to wallets(id) for SYSTEM wallet etc.

  active boolean not null default true,

  created_at timestamptz not null default now()
);


-- Trigger helper to keep updated_at fresh
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_wallets_updated_at on wallets;
create trigger set_wallets_updated_at
before update on wallets
for each row
execute procedure set_updated_at();

drop trigger if exists set_withdrawals_updated_at on withdrawals;
create trigger set_withdrawals_updated_at
before update on withdrawals
for each row
execute procedure set_updated_at();


-- Seed initial wallets (idempotent)
insert into wallets (entity_type, entity_id, virtual_account_code, balance)
values ('SYSTEM', null, 'TEKETEKE_MAIN', 0)
on conflict (virtual_account_code) do nothing;

insert into wallets (entity_type, entity_id, virtual_account_code, balance)
values ('MATATU', null, 'MAT0021', 0)
on conflict (virtual_account_code) do nothing;
