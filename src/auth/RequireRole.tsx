import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../state/auth";
import type { Role } from "../lib/types";
import NoAccess from "../pages/NoAccess";

export function RequireRole({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { user, status, error, loading } = useAuth();
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  const loginUrl = `/login?next=${encodeURIComponent(next)}`;

  if (status === "booting" || loading) {
    const label = status === "authenticated" ? "Loading profile..." : "Loading session...";
    return (
      <div className="app-main">
        <div className="card">{label}</div>
      </div>
    );
  }

  if (error || !user || status !== "authenticated") {
    return <Navigate to={loginUrl} replace />;
  }

  if (!allow.includes(user.role)) {
    return <NoAccess />;
  }

  return <>{children}</>;
}
