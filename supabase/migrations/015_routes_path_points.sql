-- 015_routes_path_points.sql
-- Store optional recorded GPS path for a SACCO route

alter table if exists public.routes
  add column if not exists path_points jsonb;

