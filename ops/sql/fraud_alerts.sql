-- Fraud / anomaly alerts
CREATE TABLE IF NOT EXISTS fraud_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  domain text NOT NULL DEFAULT 'teketeke',
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  entity_type text NULL,
  entity_id text NULL,
  window_from timestamptz NULL,
  window_to timestamptz NULL,
  fingerprint text NOT NULL,
  summary text NOT NULL,
  details jsonb NULL,
  resolved_at timestamptz NULL,
  resolved_by uuid NULL,
  resolution_note text NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS fraud_alerts_fingerprint_uniq
  ON fraud_alerts(domain, fingerprint);

CREATE INDEX IF NOT EXISTS fraud_alerts_status_idx
  ON fraud_alerts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS fraud_alerts_type_idx
  ON fraud_alerts(type, created_at DESC);

CREATE INDEX IF NOT EXISTS fraud_alerts_entity_idx
  ON fraud_alerts(entity_type, entity_id, created_at DESC);
