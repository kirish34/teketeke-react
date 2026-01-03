-- 061_idempotency_indexes.sql
-- C2B/STK idempotency constraints

alter table if exists public.mpesa_c2b_payments
  add column if not exists idempotency_key text generated always as (
    case
      when receipt is not null then 'receipt:' || receipt
      when checkout_request_id is not null then 'checkout:' || checkout_request_id
      when mpesa_receipt is not null then 'mpesa:' || mpesa_receipt
      else null
    end
  ) stored;

create unique index if not exists c2b_receipt_uniq
  on public.mpesa_c2b_payments(receipt)
  where receipt is not null;

create unique index if not exists c2b_checkout_request_uniq
  on public.mpesa_c2b_payments(checkout_request_id)
  where checkout_request_id is not null;

create unique index if not exists c2b_idempotency_key_uniq
  on public.mpesa_c2b_payments(idempotency_key)
  where idempotency_key is not null;
