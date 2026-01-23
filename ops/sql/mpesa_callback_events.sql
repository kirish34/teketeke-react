-- mpesa_callback_events idempotency store
-- Apply this in production before deploying callback hardening changes.

CREATE TABLE IF NOT EXISTS mpesa_callback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  domain text NOT NULL DEFAULT 'teketeke',
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'processed',
  payload jsonb NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS mpesa_callback_events_uniq
  ON mpesa_callback_events(domain, kind, idempotency_key);

CREATE INDEX IF NOT EXISTS mpesa_callback_events_created_desc
  ON mpesa_callback_events(created_at DESC);

CREATE INDEX IF NOT EXISTS mpesa_callback_events_kind_created_desc
  ON mpesa_callback_events(domain, kind, created_at DESC);
