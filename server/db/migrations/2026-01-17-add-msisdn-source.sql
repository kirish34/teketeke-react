ALTER TABLE mpesa_c2b_payments
  ADD COLUMN IF NOT EXISTS msisdn_source text;

UPDATE mpesa_c2b_payments
SET msisdn_source = COALESCE(msisdn_source, 'legacy')
WHERE msisdn_source IS NULL;
