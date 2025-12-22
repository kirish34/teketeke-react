alter table if exists public.staff_profiles
  add column if not exists matatu_id uuid references public.matatus(id) on delete set null;

create index if not exists idx_staff_profiles_matatu on public.staff_profiles(matatu_id);
