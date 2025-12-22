import { useEffect, useState } from "react";
import { ensureSupabaseClient } from "../lib/auth";

type Monitor = {
  domain: string;
  pending: number;
  approved: number;
  processing: number;
  paid: number;
  failed: number;
  rejected: number;
  cancelled: number;
  stuck_processing_10m: number;
  last_worker_tick_at: string | null;
};

function fmtDate(iso: string | null) {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WorkerMonitor() {
  const supabase = ensureSupabaseClient();
  const [m, setM] = useState<Monitor | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    setErr(null);
    const { data, error } = await supabase.from("payout_worker_monitor_v").select("*").maybeSingle();
    if (error) setErr(error.message);
    else setM(data as any);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Worker Monitor</h1>
          <p className="text-sm text-gray-600">Live status of payout pipeline and worker heartbeat.</p>
        </div>
        <button className="px-3 py-2 rounded bg-black text-white text-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {err && <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{err}</div>}

      <div className="rounded border bg-white p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div>
          <div className="text-gray-600">Pending</div>
          <div className="text-xl font-bold">{m?.pending ?? "N/A"}</div>
        </div>
        <div>
          <div className="text-gray-600">Approved</div>
          <div className="text-xl font-bold">{m?.approved ?? "N/A"}</div>
        </div>
        <div>
          <div className="text-gray-600">Processing</div>
          <div className="text-xl font-bold">{m?.processing ?? "N/A"}</div>
        </div>
        <div>
          <div className="text-gray-600">Paid</div>
          <div className="text-xl font-bold">{m?.paid ?? "N/A"}</div>
        </div>
        <div>
          <div className="text-gray-600">Failed</div>
          <div className="text-xl font-bold">{m?.failed ?? "N/A"}</div>
        </div>
        <div>
          <div className="text-gray-600">Rejected</div>
          <div className="text-xl font-bold">{m?.rejected ?? "N/A"}</div>
        </div>
        <div>
          <div className="text-gray-600">Cancelled</div>
          <div className="text-xl font-bold">{m?.cancelled ?? "N/A"}</div>
        </div>
        <div className="md:col-span-2">
          <div className="text-gray-600">Stuck processing (&gt; 10m)</div>
          <div className={`text-xl font-bold ${(m?.stuck_processing_10m ?? 0) > 0 ? "text-red-700" : ""}`}>
            {m?.stuck_processing_10m ?? "N/A"}
          </div>
        </div>
        <div className="md:col-span-5">
          <div className="text-gray-600">Last worker tick</div>
          <div className="font-semibold">{fmtDate(m?.last_worker_tick_at ?? null)}</div>
        </div>
      </div>
    </div>
  );
}
