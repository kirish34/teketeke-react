import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "../../components/DashboardShell";
import { resolveApiUrl } from "../../services/api";
import { useAuth } from "../../state/auth";
import { useActiveSacco } from "../../state/activeSacco";

type Payment = {
  id?: string;
  received_at?: string;
  created_at?: string;
  amount?: number;
  msisdn?: string;
  account_reference?: string;
  receipt?: string;
  status?: string;
  match_status?: string;
  wallet_kind?: string;
};

const WINDOW_OPTIONS = [
  { value: 5, label: "Last 5 minutes" },
  { value: 15, label: "Last 15 minutes" },
  { value: 60, label: "Last 1 hour" },
];

function formatTime(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatAmount(amount?: number | null) {
  const val = Number(amount || 0);
  if (!Number.isFinite(val)) return "";
  return `KES ${val.toLocaleString("en-KE", { minimumFractionDigits: 0 })}`;
}

export default function LivePaymentsPage() {
  const { token } = useAuth();
  const { activeSaccoId, activeSaccoName } = useActiveSacco();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [windowMinutes, setWindowMinutes] = useState<number>(15);
  const [paused, setPaused] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const saccoLabel = useMemo(() => activeSaccoName || activeSaccoId || "—", [activeSaccoId, activeSaccoName]);

  const fetchPayments = useCallback(async () => {
    if (!token || !activeSaccoId || paused) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const fromIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const url = resolveApiUrl(
      `/api/sacco/live-payments?sacco_id=${encodeURIComponent(activeSaccoId)}&from=${encodeURIComponent(
        fromIso,
      )}&limit=50`,
    );

    try {
      const res = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
          "x-active-sacco-id": activeSaccoId,
        },
        signal: controller.signal,
      });
      const reqId = res.headers.get("x-request-id");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || res.statusText || "Failed to load live payments";
        setError(reqId ? `${msg} (request ${reqId})` : msg);
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
  }, [activeSaccoId, paused, token, windowMinutes]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    clearTimer();
    if (!activeSaccoId || paused || document.visibilityState === "hidden") return;
    void fetchPayments();
    timerRef.current = setInterval(() => {
      void fetchPayments();
    }, 5000);
  }, [activeSaccoId, clearTimer, fetchPayments, paused]);

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

  const handlePauseToggle = useCallback(() => {
    setPaused((prev) => !prev);
  }, []);

  useEffect(() => {
    // Restart polling when pause state changes
    startPolling();
  }, [paused, windowMinutes, activeSaccoId, startPolling]);

  const emptyState = !loading && payments.length === 0;

  return (
    <DashboardShell title="Live Payments" subtitle={saccoLabel}>
      <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 18 }}>Live Payments</div>
            <div style={{ color: "#555", fontSize: 13 }}>
              Auto-refreshes every 5 seconds for the selected window.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              Window
              <select
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
                style={{ padding: "6px 8px" }}
              >
                {WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={handlePauseToggle}>
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#444" }}>
            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString("en-KE") : "—"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {loading ? <span className="spinner small" aria-label="Loading" /> : null}
            <button type="button" className="btn ghost" onClick={() => void fetchPayments()} disabled={!activeSaccoId}>
              Refresh now
            </button>
          </div>
        </div>

        {!activeSaccoId ? (
          <div className="banner warn">Select an operator to view live payments.</div>
        ) : null}

        {error ? (
          <div className="banner error" role="alert">
            {error}
          </div>
        ) : null}

        {emptyState ? (
          <div className="empty">No new payments yet</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Amount</th>
                  <th>MSISDN</th>
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
                    <td>{p.msisdn || "—"}</td>
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
