-- Notification metadata for fraud alerts
ALTER TABLE fraud_alerts
  ADD COLUMN IF NOT EXISTS notified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS notified_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS assigned_to uuid NULL,
  ADD COLUMN IF NOT EXISTS assigned_note text NULL;

CREATE TABLE IF NOT EXISTS fraud_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  domain text NOT NULL DEFAULT 'teketeke',
  alert_id uuid NOT NULL REFERENCES fraud_alerts(id) ON DELETE CASCADE,
  channel text NOT NULL, -- SMS | EMAIL | CONSOLE
  "to" text NOT NULL,
  status text NOT NULL, -- sent | failed
  error_message text NULL,
  request_id text NULL
);

CREATE INDEX IF NOT EXISTS fraud_alerts_last_notified_idx
  ON fraud_alerts (last_notified_at DESC);

CREATE INDEX IF NOT EXISTS fraud_notifications_alert_idx
  ON fraud_notifications (alert_id, created_at DESC);
