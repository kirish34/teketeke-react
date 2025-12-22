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

export default function PayoutHistory() {
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
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payout History</h1>
          <p className="text-sm text-gray-600">Audit trail for all payouts across statuses.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="px-3 py-2 rounded border text-sm"
            onClick={requeueStuck}
            disabled={loading}
            title="Requeue payouts stuck in processing too long"
          >
            Requeue stuck
          </button>

          <button className="px-3 py-2 rounded bg-black text-white text-sm" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded border bg-white p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              className={`px-3 py-1.5 rounded text-sm border ${status === s ? "bg-black text-white" : "bg-white"}`}
              onClick={() => setStatus(s)}
              disabled={loading}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-gray-600">From</label>
            <input className="w-full border rounded p-2 text-sm" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-600">To</label>
            <input className="w-full border rounded p-2 text-sm" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs text-gray-600">Search (wallet code/label, phone, provider ref, payout id)</label>
            <input
              className="w-full border rounded p-2 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. 21001 / Owner John / 2547... / ConversationID..."
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="text-gray-600">Showing up to 200 rows</div>
          <div className="font-semibold">Total shown: {fmtKES(totalAmount)}</div>
        </div>
      </div>

      {err && (
        <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">
          {err}
        </div>
      )}

      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="text-left p-3">Created</th>
              <th className="text-left p-3">Wallet</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Amount</th>
              <th className="text-left p-3">Destination</th>
              <th className="text-left p-3">Provider Ref</th>
              <th className="text-left p-3">Attempts</th>
              <th className="text-left p-3">Last Error</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan={9}>
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan={9}>
                  No payouts in this range.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const stuckMins = r.status === "processing" ? minutesSince(r.processing_started_at) : null;
                const canRetry = r.status === "failed" || r.status === "processing" || r.status === "approved";

                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3 whitespace-nowrap">
                      <div>{fmtDate(r.created_at)}</div>
                      <div className="text-xs text-gray-500">Upd: {fmtDate(r.updated_at)}</div>
                      {stuckMins !== null && (
                        <div className={`text-xs mt-1 ${stuckMins >= 10 ? "text-red-700" : "text-gray-600"}`}>
                          Processing: {stuckMins} min
                        </div>
                      )}
                    </td>

                    <td className="p-3">
                      <div className="font-semibold">{r.wallet_code}</div>
                      <div className="text-gray-600">{r.wallet_label || "N/A"}</div>
                      <div className="text-xs text-gray-500 break-all">{r.wallet_id}</div>
                    </td>

                    <td className="p-3">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          r.status === "paid"
                            ? "bg-green-100 text-green-800"
                            : r.status === "failed"
                            ? "bg-red-100 text-red-800"
                            : r.status === "processing"
                            ? "bg-yellow-100 text-yellow-800"
                            : r.status === "approved"
                            ? "bg-blue-100 text-blue-800"
                            : r.status === "pending"
                            ? "bg-gray-100 text-gray-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {r.status.toUpperCase()}
                      </span>

                      {r.reason_code && <div className="text-xs text-gray-600 mt-1">Reason: {r.reason_code}</div>}
                    </td>

                    <td className="p-3 font-semibold whitespace-nowrap">{fmtKES(r.amount)}</td>

                    <td className="p-3">
                      <div>{r.destination_phone}</div>
                    </td>

                    <td className="p-3 break-all">{r.provider_reference || "N/A"}</td>

                    <td className="p-3">{r.attempts ?? 0}</td>

                    <td className="p-3">
                      <div className="text-xs text-gray-700 whitespace-pre-wrap">{r.last_error ? r.last_error : "N/A"}</div>
                    </td>

                    <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          className={`px-3 py-1.5 rounded text-white text-sm ${canRetry ? "bg-black" : "bg-gray-300"}`}
                          onClick={() => retryNow(r.id)}
                          disabled={loading || !canRetry}
                          title="Schedules retry in ~1 minute"
                        >
                          Retry
                        </button>
                        <Link
                          to={`/matatu/withdrawal-phones/${encodeURIComponent(r.wallet_id)}`}
                          className="px-3 py-1.5 rounded border text-sm"
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
    </div>
  );
}
