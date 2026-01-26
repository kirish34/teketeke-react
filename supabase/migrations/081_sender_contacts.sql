-- 081_sender_contacts.sql
-- Simple phonebook for mapping incoming payment MSISDNs (including hashed IDs) to sender names.

create table if not exists public.sender_contacts (
  msisdn text primary key, -- raw or hashed MSISDN as stored in mpesa_c2b_payments.msisdn
  sender_name text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sender_contacts_name on public.sender_contacts(sender_name);
