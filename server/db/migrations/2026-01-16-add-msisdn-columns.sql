-- Add normalized and display MSISDN columns for C2B payments
ALTER TABLE mpesa_c2b_payments
  ADD COLUMN IF NOT EXISTS msisdn_normalized text,
  ADD COLUMN IF NOT EXISTS display_msisdn text,
  ADD COLUMN IF NOT EXISTS msisdn_source text;

-- Backfill normalized MSISDN where possible
UPDATE mpesa_c2b_payments
SET msisdn_normalized = COALESCE(
    msisdn_normalized,
    CASE
      WHEN msisdn ~ '^2547[0-9]{8}$' THEN msisdn
      WHEN msisdn ~ '^07[0-9]{8}$' THEN '254' || substr(msisdn, 2)
      WHEN msisdn ~ '^7[0-9]{8}$' THEN '254' || msisdn
      ELSE NULL
    END,
    CASE
      WHEN pg_typeof(raw)::text IN ('json', 'jsonb') AND (raw->>'MSISDN') ~ '^2547[0-9]{8}$' THEN raw->>'MSISDN'
      WHEN pg_typeof(raw)::text IN ('json', 'jsonb') AND (raw->>'MSISDN') ~ '^07[0-9]{8}$' THEN '254' || substr(raw->>'MSISDN', 2)
      WHEN pg_typeof(raw)::text IN ('json', 'jsonb') AND (raw->>'MSISDN') ~ '^7[0-9]{8}$' THEN '254' || (raw->>'MSISDN')
      WHEN pg_typeof(raw)::text IN ('json', 'jsonb') AND (raw->>'msisdn') ~ '^2547[0-9]{8}$' THEN raw->>'msisdn'
      WHEN pg_typeof(raw)::text IN ('json', 'jsonb') AND (raw->>'msisdn') ~ '^07[0-9]{8}$' THEN '254' || substr(raw->>'msisdn', 2)
      WHEN pg_typeof(raw)::text IN ('json', 'jsonb') AND (raw->>'msisdn') ~ '^7[0-9]{8}$' THEN '254' || (raw->>'msisdn')
      ELSE NULL
    END
)
WHERE msisdn_normalized IS NULL;

-- Backfill display values using normalized where available
UPDATE mpesa_c2b_payments
SET display_msisdn = COALESCE(
    display_msisdn,
    CASE
      WHEN msisdn_normalized ~ '^2547[0-9]{8}$' THEN substr(msisdn_normalized, 1, 4) || '******' || substr(msisdn_normalized, 10, 3)
      ELSE NULL
    END
)
WHERE display_msisdn IS NULL;

-- Mark legacy rows for audit
UPDATE mpesa_c2b_payments
SET msisdn_source = COALESCE(msisdn_source, 'legacy')
WHERE msisdn_source IS NULL;

CREATE INDEX IF NOT EXISTS mpesa_c2b_payments_msisdn_normalized_idx ON mpesa_c2b_payments(msisdn_normalized);
