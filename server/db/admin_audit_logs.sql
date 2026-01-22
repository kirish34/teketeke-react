-- Admin audit log table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  domain text NOT NULL DEFAULT 'teketeke',
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  payload jsonb,
  ip text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor ON public.admin_audit_logs (actor_user_id);
