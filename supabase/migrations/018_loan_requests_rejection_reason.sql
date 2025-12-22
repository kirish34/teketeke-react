-- 018_loan_requests_rejection_reason.sql
-- Add optional rejection reason for loan requests

alter table if exists public.loan_requests
  add column if not exists rejection_reason text;

