import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth";

export default function PendingAccess() {
  const { user, refreshProfile, contextMissing } = useAuth();
  const nav = useNavigate();

  const handleRetry = useCallback(async () => {
    await refreshProfile();
  }, [refreshProfile]);

  const handleBack = useCallback(() => {
    nav("/login", { replace: true });
  }, [nav]);

  return (
    <div className="app-main" style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <div className="card" style={{ background: "white", border: "1px solid #e2e8f0" }}>
        <h2 style={{ marginTop: 0 }}>Access pending</h2>
        <p style={{ color: "#475569" }}>
          Your account is active but has no dashboard role assigned yet. Contact an administrator to grant you access.
        </p>
        <ul style={{ lineHeight: 1.6, color: "#334155" }}>
          <li>User ID: <code>{user?.id || "unknown"}</code></li>
          <li>Email: <code>{user?.email || "unknown"}</code></li>
          <li>Context missing: {contextMissing ? "yes" : "no"}</li>
        </ul>
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button type="button" onClick={handleRetry}>
            Retry
          </button>
          <button type="button" className="ghost" onClick={handleBack}>
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
}
