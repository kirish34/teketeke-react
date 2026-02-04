-- Quarantine table for preventive controls
CREATE TABLE IF NOT EXISTS quarantined_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  domain text NOT NULL DEFAULT 'teketeke',
  operation_type text NOT NULL, -- WALLET_CREDIT | ADMIN_ACTION | OTHER
  operation_id text NOT NULL,
  entity_type text NULL,
  entity_id text NULL,
  reason text NOT NULL,
  source text NOT NULL, -- FRAUD_ALERT | RISK_SCORE | MANUAL
  severity text NOT NULL,
  incident_id uuid NULL,
  alert_id uuid NULL,
  status text NOT NULL DEFAULT 'quarantined', -- quarantined | released | cancelled
  released_at timestamptz NULL,
  released_by uuid NULL,
  release_note text NULL,
  payload jsonb NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS quarantined_operations_uniq_active
  ON quarantined_operations(domain, operation_type, operation_id, status);

CREATE INDEX IF NOT EXISTS quarantined_operations_status_idx
  ON quarantined_operations(status, created_at DESC);

CREATE INDEX IF NOT EXISTS quarantined_operations_operation_idx
  ON quarantined_operations(operation_type, operation_id);
