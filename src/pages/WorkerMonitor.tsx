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
    <section className="card">
      <div className="topline">
        <div>
          <h3 style={{ margin: 0 }}>Worker monitor</h3>
          <div className="muted small">Live status of payout pipeline and worker heartbeat.</div>
        </div>
        <button className="btn ghost" type="button" onClick={load}>
          Refresh
        </button>
      </div>

      {err ? <div className="err">Worker monitor error: {err}</div> : null}

      <div className="grid metrics" style={{ marginTop: 10 }}>
        <div className="metric">
          <div className="k">Pending</div>
          <div className="v">{m?.pending ?? "N/A"}</div>
        </div>
        <div className="metric">
          <div className="k">Approved</div>
          <div className="v">{m?.approved ?? "N/A"}</div>
        </div>
        <div className="metric">
          <div className="k">Processing</div>
          <div className="v">{m?.processing ?? "N/A"}</div>
        </div>
        <div className="metric">
          <div className="k">Paid</div>
          <div className="v">{m?.paid ?? "N/A"}</div>
        </div>
        <div className="metric">
          <div className="k">Failed</div>
          <div className="v">{m?.failed ?? "N/A"}</div>
        </div>
        <div className="metric">
          <div className="k">Rejected</div>
          <div className="v">{m?.rejected ?? "N/A"}</div>
        </div>
        <div className="metric">
          <div className="k">Cancelled</div>
          <div className="v">{m?.cancelled ?? "N/A"}</div>
        </div>
        <div className="metric">
          <div className="k">Stuck processing (&gt; 10m)</div>
          <div className="v" style={{ color: (m?.stuck_processing_10m ?? 0) > 0 ? "#b91c1c" : "#0f172a" }}>
            {m?.stuck_processing_10m ?? "N/A"}
          </div>
        </div>
        <div className="metric" style={{ gridColumn: "1 / -1" }}>
          <div className="k">Last worker tick</div>
          <div className="v">{fmtDate(m?.last_worker_tick_at ?? null)}</div>
        </div>
      </div>
    </section>
  );
}
