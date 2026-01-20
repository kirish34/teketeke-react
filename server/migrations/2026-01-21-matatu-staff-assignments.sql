-- Matatu staff assignments (for SACCO-admin managed mapping of staff to vehicles)
CREATE TABLE IF NOT EXISTS public.matatu_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id uuid NOT NULL,
  staff_user_id uuid NOT NULL,
  matatu_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (staff_user_id, matatu_id)
);

-- helpful indexes
CREATE INDEX IF NOT EXISTS matatu_staff_assignments_staff_idx ON public.matatu_staff_assignments (staff_user_id);
CREATE INDEX IF NOT EXISTS matatu_staff_assignments_matatu_idx ON public.matatu_staff_assignments (matatu_id);
CREATE INDEX IF NOT EXISTS matatu_staff_assignments_sacco_idx ON public.matatu_staff_assignments (sacco_id);
