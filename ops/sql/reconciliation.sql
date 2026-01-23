-- Reconciliation metadata tables

CREATE TABLE IF NOT EXISTS recon_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  domain text NOT NULL DEFAULT 'teketeke',
  from_ts timestamptz NOT NULL,
  to_ts timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  totals jsonb NULL,
  actor_user_id uuid NULL,
  actor_role text NULL,
  request_id text NULL
);

CREATE INDEX IF NOT EXISTS recon_runs_created_desc ON recon_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS recon_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  domain text NOT NULL DEFAULT 'teketeke',
  kind text NOT NULL, -- C2B | STK | B2C
  provider_ref text NOT NULL,
  internal_ref text NULL,
  amount numeric NULL,
  currency text NOT NULL DEFAULT 'KES',
  status text NOT NULL, -- matched | unmatched | mismatch_amount | duplicate | missing_internal | missing_provider
  details jsonb NULL,
  last_seen_at timestamptz DEFAULT now(),
  resolved bool DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS recon_items_provider_uniq
  ON recon_items(domain, kind, provider_ref);

CREATE INDEX IF NOT EXISTS recon_items_status_idx
  ON recon_items(status, created_at DESC);

