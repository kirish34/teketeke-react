-- 017_loan_requests_payout_disbursement.sql
-- Add payout preference and disbursement tracking to loan_requests

alter table if exists public.loan_requests
  add column if not exists payout_method text,
  add column if not exists payout_phone text,
  add column if not exists payout_account text,
  add column if not exists loan_id uuid references public.loans(id) on delete set null,
  add column if not exists disbursed_at timestamptz,
  add column if not exists disbursed_by uuid,
  add column if not exists disbursed_method text,
  add column if not exists disbursed_reference text;

do $$
begin
  begin
    alter table public.loan_requests
      add constraint loan_requests_payout_method_chk
      check (payout_method is null or payout_method in ('CASH','M_PESA','ACCOUNT'));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.loan_requests
      add constraint loan_requests_disbursed_method_chk
      check (disbursed_method is null or disbursed_method in ('CASH','M_PESA','ACCOUNT'));
  exception when duplicate_object then null;
  end;
end$$;

