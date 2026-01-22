import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ensureSupabaseClient } from "../lib/auth";

type Status = "pending" | "approved" | "processing" | "paid" | "failed" | "rejected" | "cancelled";

type Row = {
  id: string;
  created_at: string;
  updated_at: string | null;
  status: Status;
  amount: number;
  currency: string;
  destination_phone: string;
  reason_code: string | null;
  provider_reference: string | null;
  attempts: number | null;
  last_error: string | null;
  processing_started_at: string | null;
  wallet_id: string;
  wallet_code: string;
  wallet_label: string | null;
};

function fmtKES(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(n || 0);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "N/A";
  const d = new Date(iso);
  return d.toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function minutesSince(iso: string | null) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 60000);
}

const STATUS_TABS: (Status | "all")[] = [
  "all",
  "pending",
  "approved",
  "processing",
  "paid",
  "failed",
  "rejected",
  "cancelled",
];

const STATUS_STYLES: Record<Status, { bg: string; color: string }> = {
  pending: { bg: "#e2e8f0", color: "#1f2937" },
  approved: { bg: "#dbeafe", color: "#1e40af" },
  processing: { bg: "#fef9c3", color: "#854d0e" },
  paid: { bg: "#dcfce7", color: "#166534" },
  failed: { bg: "#fee2e2", color: "#991b1b" },
  rejected: { bg: "#fee2e2", color: "#991b1b" },
  cancelled: { bg: "#e2e8f0", color: "#1f2937" },
};

function getStatusStyle(status: Status) {
  return STATUS_STYLES[status] || STATUS_STYLES.pending;
}

type PayoutHistoryProps = {
  canAct?: boolean;
};

export default function PayoutHistory({ canAct = true }: PayoutHistoryProps) {
  const supabase = useMemo(() => ensureSupabaseClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rt, setRt] = useState<RealtimeChannel | null>(null);

  const [status, setStatus] = useState<Status | "all">("all");
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const totalAmount = useMemo(() => rows.reduce((a, r) => a + (r.amount || 0), 0), [rows]);

  async function load() {
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const fromIso = new Date(`${fromDate}T00:00:00.000Z`).toISOString();
      const toIso = new Date(`${toDate}T23:59:59.999Z`).toISOString();

      let query = supabase
        .from("external_payout_requests")
        .select(
          `
          id, created_at, updated_at, status, amount, currency, destination_phone, reason_code,
          provider_reference, attempts, last_error, processing_started_at,
          wallet_id,
          wallets!inner(wallet_code, label)
        `
        )
        .eq("domain", "teketeke")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(200);

      if (status !== "all") query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw error;

      let mapped: Row[] = (data || []).map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        updated_at: r.updated_at ?? null,
        status: r.status,
        amount: Number(r.amount || 0),
        currency: r.currency || "KES",
        destination_phone: r.destination_phone,
        reason_code: r.reason_code ?? null,
        provider_reference: r.provider_reference ?? null,
        attempts: r.attempts ?? null,
        last_error: r.last_error ?? null,
        processing_started_at: r.processing_started_at ?? null,
        wallet_id: r.wallet_id,
        wallet_code: r.wallets.wallet_code,
        wallet_label: r.wallets.label ?? null,
      }));

      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        mapped = mapped.filter(
          (x) =>
            (x.wallet_code || "").toLowerCase().includes(needle) ||
            (x.wallet_label || "").toLowerCase().includes(needle) ||
            (x.destination_phone || "").toLowerCase().includes(needle) ||
            (x.provider_reference || "").toLowerCase().includes(needle) ||
            (x.id || "").toLowerCase().includes(needle)
        );
      }

      setRows(mapped);
    } catch (e: any) {
      setErr(e?.message || "Failed to load payout history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initial load on filter change
    load();

    // clean previous channel
    if (rt && supabase) {
      supabase.removeChannel(rt);
      setRt(null);
    }

    if (!supabase) return;

    const channel = supabase
      .channel("payout-history-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "external_payout_requests" },
        async (payload) => {
          const rowNew: any = payload.new;
          const rowOld: any = payload.old;
          const domain = rowNew?.domain ?? rowOld?.domain;
          if (domain !== "teketeke") return;

          const createdAt = rowNew?.created_at ?? rowOld?.created_at;
          if (!createdAt) return;

          const fromIso = new Date(`${fromDate}T00:00:00.000Z`).toISOString();
          const toIso = new Date(`${toDate}T23:59:59.999Z`).toISOString();
          if (createdAt < fromIso || createdAt > toIso) return;

          const newStatus = rowNew?.status ?? rowOld?.status;
          const statusMatches = status === "all" ? true : newStatus === status;

          const { data, error } = await supabase
            .from("external_payout_requests")
            .select(
              `
              id, created_at, updated_at, status, amount, currency, destination_phone, reason_code,
              provider_reference, attempts, last_error, processing_started_at,
              wallet_id,
              wallets!inner(wallet_code, label)
            `
            )
            .eq("id", rowNew?.id ?? rowOld?.id)
            .maybeSingle();

          if (error || !data) {
            await load();
            return;
          }

          const mapped: Row = {
            id: data.id,
            created_at: data.created_at,
            updated_at: data.updated_at ?? null,
            status: data.status,
            amount: Number(data.amount || 0),
            currency: data.currency || "KES",
            destination_phone: data.destination_phone,
            reason_code: data.reason_code ?? null,
            provider_reference: data.provider_reference ?? null,
            attempts: data.attempts ?? null,
            last_error: data.last_error ?? null,
            processing_started_at: data.processing_started_at ?? null,
            wallet_id: data.wallet_id,
            wallet_code: (data as any).wallets.wallet_code,
            wallet_label: (data as any).wallets.label ?? null,
          };

          const needle = q.trim().toLowerCase();
          const passesSearch =
            !needle ||
            mapped.wallet_code.toLowerCase().includes(needle) ||
            (mapped.wallet_label || "").toLowerCase().includes(needle) ||
            (mapped.destination_phone || "").toLowerCase().includes(needle) ||
            (mapped.provider_reference || "").toLowerCase().includes(needle) ||
            mapped.id.toLowerCase().includes(needle);

          if (!statusMatches || !passesSearch) {
            setRows((prev) => prev.filter((x) => x.id !== mapped.id));
            return;
          }

          setRows((prev) => {
            const idx = prev.findIndex((x) => x.id === mapped.id);
            if (idx === -1) return [mapped, ...prev].slice(0, 200);
            const copy = prev.slice();
            copy[idx] = mapped;
            copy.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
            return copy;
          });
        }
      )
      .subscribe();

    setRt(channel);

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, fromDate, toDate, q, supabase]);

  async function retryNow(payoutId: string) {
    if (!canAct) {
      setErr("View-only: You do not have permission to retry payouts.");
      return;
    }
    if (!window.confirm(`Retry payout ${payoutId}?`)) {
      setErr(null);
      return;
    }
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const next = new Date(Date.now() + 60000).toISOString();
      const { error } = await supabase.rpc("schedule_payout_retry", {
        p_payout_id: payoutId,
        p_next_retry_at: next,
        p_error: "Manual retry requested",
      });
      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(e?.message || "Retry failed");
    } finally {
      setLoading(false);
    }
  }

  async function requeueStuck() {
    if (!canAct) {
      setErr("View-only: You do not have permission to requeue payouts.");
      return;
    }
    if (!window.confirm("Requeue payouts stuck in processing?")) {
      setErr(null);
      return;
    }
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc("requeue_stuck_payouts", {
        p_domain: "teketeke",
        p_stuck_minutes: 10,
        p_error: "Manual requeue from dashboard",
      });
      if (error) throw error;
      await load();
      alert(`Requeued stuck payouts: ${data || 0}`);
    } catch (e: any) {
      setErr(e?.message || "Requeue failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <div className="topline">
        <div>
          <h3 style={{ margin: 0 }}>B2C payout history</h3>
          <div className="muted small">Audit trail for all payouts across statuses.</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn ghost"
            type="button"
            onClick={requeueStuck}
            disabled={loading || !canAct}
            title="Requeue payouts stuck in processing too long"
          >
            {canAct ? "Requeue stuck" : "🔒 Admin only"}
          </button>
          <button className="btn" type="button" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            className={status === s ? "btn" : "btn ghost"}
            type="button"
            onClick={() => setStatus(s)}
            disabled={loading}
            style={{ padding: "6px 12px", fontSize: 12 }}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="grid g2" style={{ marginTop: 10 }}>
        <label className="muted small">
          From
          <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="muted small">
          To
          <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label className="muted small" style={{ gridColumn: "1 / -1" }}>
          Search (wallet code/label, phone, provider ref, payout id)
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. 21001 / Owner John / 2547... / ConversationID..."
          />
        </label>
      </div>

      <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
        <span className="muted small">Showing up to 200 rows</span>
        <span className="small" style={{ fontWeight: 700 }}>
          Total shown: {fmtKES(totalAmount)}
        </span>
      </div>

      {err ? <div className="err">Payouts error: {err}</div> : null}

      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Wallet</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Destination</th>
              <th>Provider Ref</th>
              <th>Attempts</th>
              <th>Last Error</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={9}>
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={9}>
                  No payouts in this range.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const stuckMins = r.status === "processing" ? minutesSince(r.processing_started_at) : null;
                const canRetry = r.status === "failed" || r.status === "processing" || r.status === "approved";
                const statusStyle = getStatusStyle(r.status);

                return (
                  <tr key={r.id}>
                    <td className="mono">
                      <div>{fmtDate(r.created_at)}</div>
                      <div className="muted small">Upd: {fmtDate(r.updated_at)}</div>
                      {stuckMins !== null && (
                        <div
                          className="small"
                          style={{ color: stuckMins >= 10 ? "#b91c1c" : "#475569", marginTop: 4 }}
                        >
                          Processing: {stuckMins} min
                        </div>
                      )}
                    </td>

                    <td>
                      <div style={{ fontWeight: 700 }}>{r.wallet_code}</div>
                      <div className="muted">{r.wallet_label || "N/A"}</div>
                      <div className="muted small mono" style={{ wordBreak: "break-all" }}>
                        {r.wallet_id}
                      </div>
                    </td>

                    <td>
                      <span
                        className="small"
                        style={{
                          background: statusStyle.bg,
                          color: statusStyle.color,
                          padding: "4px 8px",
                          borderRadius: 999,
                          display: "inline-block",
                          fontWeight: 800,
                          letterSpacing: "0.02em",
                        }}
                      >
                        {r.status.toUpperCase()}
                      </span>

                      {r.reason_code ? (
                        <div className="muted small" style={{ marginTop: 6 }}>
                          Reason: {r.reason_code}
                        </div>
                      ) : null}
                    </td>

                    <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmtKES(r.amount)}</td>

                    <td className="mono">{r.destination_phone}</td>

                    <td className="mono" style={{ wordBreak: "break-all" }}>
                      {r.provider_reference || "N/A"}
                    </td>

                    <td>{r.attempts ?? 0}</td>

                    <td>
                      <div className="muted small" style={{ whiteSpace: "pre-wrap" }}>
                        {r.last_error ? r.last_error : "N/A"}
                      </div>
                    </td>

                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => retryNow(r.id)}
                          disabled={loading || !canRetry || !canAct}
                          title="Schedules retry in ~1 minute"
                        >
                          {canAct ? "Retry" : "🔒 Admin only"}
                        </button>
                        <Link
                          to={`/matatu/withdrawal-phones/${encodeURIComponent(r.wallet_id)}`}
                          className="btn ghost"
                          title="Manage approved withdrawal phones for this wallet"
                        >
                          Phones
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
