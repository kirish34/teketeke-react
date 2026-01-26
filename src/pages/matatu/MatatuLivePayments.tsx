import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import DashboardShell from "../../components/DashboardShell";
import { resolveApiUrl } from "../../services/api";
import { useAuth } from "../../state/auth";
import { authFetch } from "../../lib/auth";

type Payment = {
  id?: string;
  received_at?: string;
  created_at?: string;
  amount?: number;
  msisdn?: string;
  sender_name?: string;
  account_reference?: string;
  receipt?: string;
  status?: string;
  match_status?: string;
  wallet_kind?: string;
};

const WINDOWS = [
  { value: 15, label: "Last 15 minutes" },
  { value: 60, label: "Last 1 hour" },
  { value: 360, label: "Last 6 hours" },
  { value: 1440, label: "Last 24 hours" },
];

const LIMITS = [20, 50, 100, 200];

function formatTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatAmount(amount?: number | null) {
  const val = Number(amount || 0);
  if (!Number.isFinite(val)) return "—";
  return `KES ${val.toLocaleString("en-KE")}`;
}

export default function MatatuLivePayments() {
  const { token, user, logout } = useAuth();
  const [matatuId, setMatatuId] = useState<string>(user?.matatu_id || "");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [windowMinutes, setWindowMinutes] = useState<number>(15);
  const [limit, setLimit] = useState<number>(50);
  const [paused, setPaused] = useState(false);

  const inflightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logoutRef = useRef(false);
  const autoPausedRef = useRef(false);

  const nav = (
    <>
      <NavLink className={({ isActive }) => `tab${isActive ? " active" : ""}`} to="/matatu/staff">
        Dashboard
      </NavLink>
      <NavLink className={({ isActive }) => `tab${isActive ? " active" : ""}`} to="/matatu/live-payments">
        Live Payments
      </NavLink>
    </>
  );

  const resolveAssignment = useCallback(async (force = false) => {
    if (!force && matatuId && user?.role !== "matatu_staff") {
      return { updated: false, matatuId: matatuId || null };
    }
    try {
      const res = await authFetch("/api/matatu/my-assignment", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return { updated: false, matatuId: null };
      const data = await res.json().catch(() => ({}));
      const nextMatatuId = data?.matatu_id ? String(data.matatu_id) : "";
      if (nextMatatuId && nextMatatuId !== matatuId) {
        setMatatuId(nextMatatuId);
        setError(null);
        if (autoPausedRef.current) {
          autoPausedRef.current = false;
          setPaused(false);
        }
        return { updated: true, matatuId: nextMatatuId };
      }
      if (!nextMatatuId && user?.role === "matatu_staff" && matatuId) {
        setMatatuId("");
        setError(null);
        return { updated: true, matatuId: null };
      }
      return { updated: false, matatuId: nextMatatuId || null };
    } catch {
      return { updated: false, matatuId: null };
    }
  }, [matatuId, user?.role]);

  const fetchPayments = useCallback(async () => {
    if (!token || !matatuId || paused) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const fromIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const url = resolveApiUrl(
      `/api/matatu/live-payments?matatu_id=${encodeURIComponent(matatuId)}&from=${encodeURIComponent(
        fromIso,
      )}&limit=${limit}`,
    );

    try {
      const res = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        signal: controller.signal,
      });
      const reqId = res.headers.get("x-request-id");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setPaused(true);
          autoPausedRef.current = true;
          if (!logoutRef.current) {
            logoutRef.current = true;
            void logout();
          }
          return;
        }
        if (res.status === 403 && (data?.code === "MATATU_ACCESS_DENIED" || data?.error === "forbidden")) {
          const assignment = await resolveAssignment(true);
          if (assignment.updated) return;
          setPaused(true);
          autoPausedRef.current = true;
          const msg = "No matatu assignment found for this account. Contact SACCO admin.";
          const idPart = reqId || data?.request_id;
          setError(idPart ? `${msg} (request ${idPart})` : msg);
          return;
        }
        const msg = (data && (data.error || data.message)) || res.statusText || "Failed to load live payments";
        const idPart = reqId || data?.request_id;
        setError(idPart ? `${msg} (request ${idPart})` : msg);
        return;
      }
      setPayments(Array.isArray(data?.payments) ? data.payments : []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Failed to load live payments";
      setError(msg);
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, [limit, matatuId, paused, resolveAssignment, token, windowMinutes, logout]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    clearTimer();
    if (!matatuId || paused || document.visibilityState === "hidden") return;
    void fetchPayments();
    timerRef.current = setInterval(() => {
      void fetchPayments();
    }, 5000);
  }, [clearTimer, fetchPayments, matatuId, paused]);

  useEffect(() => {
    void resolveAssignment();
  }, [resolveAssignment]);

  useEffect(() => {
    startPolling();
    return () => {
      clearTimer();
      abortRef.current?.abort();
    };
  }, [startPolling, clearTimer]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        abortRef.current?.abort();
      } else {
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [startPolling, clearTimer]);

  useEffect(() => {
    startPolling();
  }, [windowMinutes, limit, matatuId, paused, startPolling]);

  const empty = !loading && payments.length === 0;

  return (
    <DashboardShell title="Live Payments" subtitle={matatuId || "Matatu"} navLabel="Matatu navigation" hideShellChrome>
      <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          {nav}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Live Payments</div>
            <div className="muted small">Auto-refreshes every 5 seconds</div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <label className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Since
              <select value={windowMinutes} onChange={(e) => setWindowMinutes(Number(e.target.value))}>
                {WINDOWS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Limit
              <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                {LIMITS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setPaused((p) => {
                  autoPausedRef.current = false;
                  return !p;
                })
              }
            >
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div className="muted small">
            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString("en-KE") : "—"}
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            {loading ? <span className="spinner small" aria-label="Loading" /> : null}
            <button type="button" className="btn ghost" onClick={() => void fetchPayments()} disabled={!matatuId}>
              Refresh now
            </button>
          </div>
        </div>

        {!matatuId ? (
          <div className="banner warn">No matatu assignment found for this account. Contact SACCO admin.</div>
        ) : null}

        {error ? (
          <div className="banner error" role="alert">
            {error}
          </div>
        ) : null}

        {empty ? (
          <div className="empty">No payments yet</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Amount</th>
                  <th>Sender</th>
                  <th>Account Ref</th>
                  <th>Receipt</th>
                  <th>Status</th>
                  <th>Wallet</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id || `${p.receipt}-${p.account_reference}-${p.created_at}`}>
                    <td>{formatTime(p.received_at || p.created_at)}</td>
                    <td>{formatAmount(p.amount)}</td>
                    <td>{p.sender_name || p.msisdn || "—"}</td>
                    <td>{p.account_reference || "—"}</td>
                    <td>{p.receipt || "—"}</td>
                    <td>
                      {(p.status || "").toUpperCase()}
                      {p.match_status ? ` (${p.match_status})` : ""}
                    </td>
                    <td>{p.wallet_kind || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
