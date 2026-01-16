import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../state/auth";
import type { Role } from "../lib/types";

export function RequireRole({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { user, status, error } = useAuth();
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  const loginUrl = `/login?next=${encodeURIComponent(next)}`;

  if (status === "booting") {
    return (
      <div className="app-main">
        <div className="card">Checking access...</div>
      </div>
    );
  }

  if (error || !user || status !== "authenticated") {
    return <Navigate to={loginUrl} replace />;
  }

  if (!allow.includes(user.role)) {
    return <Navigate to={loginUrl} replace />;
  }

  return <>{children}</>;
}
