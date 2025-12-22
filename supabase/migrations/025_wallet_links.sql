-- Add wallet_id links to core entities (one-to-one wallet per entity)

alter table if exists matatus
  add column if not exists wallet_id uuid references wallets(id);

alter table if exists saccos
  add column if not exists wallet_id uuid references wallets(id);

alter table if exists taxis
  add column if not exists wallet_id uuid references wallets(id);

alter table if exists bodabodas
  add column if not exists wallet_id uuid references wallets(id);
