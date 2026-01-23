ALTER TABLE admin_audit_logs
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS error_code text;

CREATE INDEX IF NOT EXISTS admin_audit_logs_domain_created_idx
  ON admin_audit_logs(domain, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_user_created_idx
  ON admin_audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_action_created_idx
  ON admin_audit_logs(action, created_at DESC);
