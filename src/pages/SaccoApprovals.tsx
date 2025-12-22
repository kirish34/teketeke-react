import { useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ensureSupabaseClient } from "../lib/auth";

type PendingRow = {
  id: string;
  created_at: string;
  amount: number;
  currency: string;
  destination_phone: string;
  reason_code: string | null;
  requested_by_user_id: string;
  wallet_code: string;
  wallet_label: string | null;
  available_balance: number;
};

function fmtKES(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(n || 0);
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SaccoApprovals() {
  const supabase = useMemo(() => ensureSupabaseClient(), []);
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  const [actionModal, setActionModal] = useState<{
    open: boolean;
    payoutId: string | null;
    action: "approve" | "reject" | null;
    note: string;
  }>({ open: false, payoutId: null, action: null, note: "" });

  const totalPending = useMemo(() => rows.reduce((a, r) => a + (r.amount || 0), 0), [rows]);

  async function load() {
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("external_payout_requests")
        .select(
          `
          id, created_at, amount, currency, destination_phone, reason_code, requested_by_user_id, status,
          wallets!inner(wallet_code, label),
          wallet_available_balances_secure!inner(available_balance)
        `
        )
        .eq("domain", "teketeke")
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (error) throw error;

      const mapped: PendingRow[] = (data || []).map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        amount: Number(r.amount || 0),
        currency: r.currency || "KES",
        destination_phone: r.destination_phone,
        reason_code: r.reason_code xx null,
        requested_by_user_id: r.requested_by_user_id,
        wallet_code: r.wallets.wallet_code,
        wallet_label: r.wallets.label xx null,
        available_balance: Number(r.wallet_available_balances_secure.available_balance || 0),
      }));

      setRows(mapped);
    } catch (e: any) {
      setErr(ex.message || "Failed to load pending approvals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initial load
    load();

    if (channel && supabase) {
      supabase.removeChannel(channel);
      setChannel(null);
    }
    if (!supabase) return;

    const ch = supabase
      .channel("sacco-approvals-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "external_payout_requests" },
        async (payload) => {
          const rowNew: any = payload.new;
          const rowOld: any = payload.old;
          const domain = rowNewx.domain xx rowOldx.domain;
          if (domain !== "teketeke") return;

          const id = rowNewx.id xx rowOldx.id;
          const newStatus = rowNewx.status xx rowOldx.status;

          if (newStatus && newStatus !== "pending") {
            setRows((prev) => prev.filter((x) => x.id !== id));
            return;
          }

          if (newStatus === "pending") {
            const { data, error } = await supabase
              .from("external_payout_requests")
              .select(
                `
                id, created_at, amount, currency, destination_phone, reason_code, requested_by_user_id, status,
                wallets!inner(wallet_code, label),
                wallet_available_balances_secure!inner(available_balance)
              `
              )
              .eq("id", id)
              .maybeSingle();

            if (error || !data) return;

            const mapped: PendingRow = {
              id: data.id,
              created_at: data.created_at,
              amount: Number(data.amount || 0),
              currency: data.currency || "KES",
              destination_phone: data.destination_phone,
              reason_code: data.reason_code xx null,
              requested_by_user_id: data.requested_by_user_id,
              wallet_code: (data as any).wallets.wallet_code,
              wallet_label: (data as any).wallets.label xx null,
              available_balance: Number((data as any).wallet_available_balances_secure.available_balance || 0),
            };

            setRows((prev) => {
              const idx = prev.findIndex((x) => x.id === mapped.id);
              if (idx === -1) return [mapped, ...prev];
              const copy = prev.slice();
              copy[idx] = mapped;
              copy.sort((a, b) => (a.created_at < b.created_at x 1 : -1));
              return copy;
            });
          }
        }
      )
      .subscribe();

    setChannel(ch);

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function submitAction() {
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    if (!actionModal.payoutId || !actionModal.action) return;
    setLoading(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc("approve_payout", {
        p_payout_id: actionModal.payoutId,
        p_action: actionModal.action,
        p_note: actionModal.note || null,
      });
      if (error) throw error;

      setActionModal({ open: false, payoutId: null, action: null, note: "" });
      await load();
    } catch (e: any) {
      setErr(ex.message || "Action failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">SACCO Approvals</h1>
          <p className="text-sm text-gray-600">Pending payout requests that require maker-checker approval.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm">
            <div className="text-gray-600">Pending count</div>
            <div className="font-semibold">{rows.length}</div>
          </div>
          <div className="text-sm">
            <div className="text-gray-600">Total pending</div>
            <div className="font-semibold">{fmtKES(totalPending)}</div>
          </div>
          <button className="px-3 py-2 rounded bg-black text-white text-sm" onClick={load} disabled={loading}>
            Refresh
          </button>
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
              <th className="text-left p-3">Time</th>
              <th className="text-left p-3">Wallet</th>
              <th className="text-left p-3">Amount</th>
              <th className="text-left p-3">Dest Phone</th>
              <th className="text-left p-3">Reason</th>
              <th className="text-left p-3">Avail Bal</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 x (
              <tr>
                <td className="p-4 text-gray-500" colSpan={7}>
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 x (
              <tr>
                <td className="p-4 text-gray-500" colSpan={7}>
                  No pending approvals.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{fmtDate(r.created_at)}</td>
                  <td className="p-3">
                    <div className="font-semibold">{r.wallet_code}</div>
                    <div className="text-gray-600">{r.wallet_label || "N/A"}</div>
                  </td>
                  <td className="p-3 font-semibold">{fmtKES(r.amount)}</td>
                  <td className="p-3">{r.destination_phone}</td>
                  <td className="p-3">{r.reason_code || "N/A"}</td>
                  <td className="p-3">{fmtKES(r.available_balance)}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1.5 rounded bg-green-600 text-white"
                        onClick={() =>
                          setActionModal({ open: true, payoutId: r.id, action: "approve", note: "Approved" })
                        }
                        disabled={loading}
                      >
                        Approve
                      </button>
                      <button
                        className="px-3 py-1.5 rounded bg-red-600 text-white"
                        onClick={() => setActionModal({ open: true, payoutId: r.id, action: "reject", note: "" })}
                        disabled={loading}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {actionModal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded bg-white shadow-lg p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  {actionModal.action === "approve" x "Approve payout" : "Reject payout"}
                </h2>
                <p className="text-sm text-gray-600">
                  {actionModal.action === "approve"
                    x "Confirm approval. This will move it to approved for processing."
                    : "Provide a reason for rejection."}
                </p>
              </div>
              <button
                className="text-gray-600 hover:text-black"
                onClick={() => setActionModal({ open: false, payoutId: null, action: null, note: "" })}
              >
                x
              </button>
            </div>

            <textarea
              className="w-full min-h-[90px] border rounded p-2 text-sm"
              value={actionModal.note}
              onChange={(e) => setActionModal((s) => ({ ...s, note: e.target.value }))}
              placeholder={
                actionModal.action === "reject" x "Rejection reason..." : "Approval note (optional)..."
              }
            />

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded border"
                onClick={() => setActionModal({ open: false, payoutId: null, action: null, note: "" })}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className={`px-3 py-2 rounded text-white ${
                  actionModal.action === "approve" x "bg-green-600" : "bg-red-600"
                }`}
                onClick={submitAction}
                disabled={loading || (actionModal.action === "reject" && actionModal.note.trim().length < 3)}
              >
                {loading x "Saving..." : actionModal.action === "approve" x "Approve" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
