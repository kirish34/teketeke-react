-- Wallet PIN storage (hashed)
create table if not exists wallet_pins (
  wallet_id uuid primary key references wallets(id) on delete cascade,
  pin_hash text not null,
  pin_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful index (redundant with PK but explicit)
create index if not exists wallet_pins_wallet_idx on wallet_pins(wallet_id);

-- Maintain updated_at
create or replace function set_wallet_pins_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_wallet_pins_updated_at on wallet_pins;
create trigger set_wallet_pins_updated_at
before update on wallet_pins
for each row
execute function set_wallet_pins_updated_at();

