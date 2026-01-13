import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useProfile } from "../lib/profile";

type Props = {
  allow?: string | string[];
  allowed?: string | string[];
  children: ReactNode;
};

function roleSelectUrl(next: string) {
  return `/role?next=${encodeURIComponent(next)}`;
}

export function RequireRole({ allow, allowed, children }: Props) {
  const { profile, loading, error } = useProfile();
  const location = useLocation();
  const navigate = useNavigate();
  const allowedInput = allowed ?? allow ?? [];
  const allowedRoles = useMemo(() => {
    const list = Array.isArray(allowedInput) ? allowedInput : [allowedInput];
    return list.filter(Boolean);
  }, [allowedInput]);
  const next = location.pathname + location.search;

  useEffect(() => {
    if (loading) return;
    if (error) {
      navigate(roleSelectUrl(next), { replace: true });
      return;
    }
    const role = profile?.role || "";
    if (!role || !allowedRoles.includes(role)) {
      navigate(roleSelectUrl(next), { replace: true });
    }
  }, [allowedRoles, error, loading, navigate, next, profile]);

  if (loading) {
    return (
      <div className="app-main">
        <div className="card">Checking access...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-main">
        <div className="card err">Auth error: {error}</div>
      </div>
    );
  }

  if (!profile || !allowedRoles.includes(profile.role || "")) {
    return null;
  }

  return <>{children}</>;
}

export default RequireRole;
