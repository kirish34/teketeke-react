DROP VIEW IF EXISTS public.app_user_context;

CREATE VIEW public.app_user_context AS
SELECT
  u.id AS user_id,
  u.email,
  COALESCE(ur.role::text, sp.role::text, 'USER') AS effective_role,
  COALESCE(ur.sacco_id, sp.sacco_id) AS sacco_id,
  COALESCE(ur.matatu_id, sp.matatu_id) AS matatu_id
FROM auth.users u
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
LEFT JOIN public.staff_profiles sp ON sp.user_id = u.id;
