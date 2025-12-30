import { useCallback, useEffect, useMemo, useState } from "react"
import DashboardShell from "../components/DashboardShell"
import { api } from "../services/api"
import { useAuth } from "../state/auth"
import VehicleCarePage from "../modules/vehicleCare/VehicleCarePage"
import { fetchAccessGrants, type AccessGrant } from "../modules/vehicleCare/vehicleCare.api"

type Sacco = { sacco_id?: string; name?: string }
type Matatu = { id?: string; number_plate?: string; sacco_id?: string }
type Route = { id?: string; name?: string; code?: string }
type Tx = {
  id?: string
  created_at?: string
  kind?: string
  status?: string
  matatu_id?: string
  fare_amount_kes?: number
  msisdn?: string
}

const fmtKES = (val?: number | null) => `KES ${(Number(val || 0)).toLocaleString("en-KE")}`
const todayKey = () => new Date().toISOString().slice(0, 10)
const manualKey = (matatuId: string) => `tt_staff_manual_${matatuId || "na"}`

const MatatuStaffDashboard = () => {
  const { token, user, logout } = useAuth()

  const [saccos, setSaccos] = useState<Sacco[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [matatus, setMatatus] = useState<Matatu[]>([])
  const [saccoId, setSaccoId] = useState("")
  const [routeId, setRouteId] = useState("")
  const [matatuId, setMatatuId] = useState("")

  const [txs, setTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [manualAmount, setManualAmount] = useState("")
  const [manualNote, setManualNote] = useState("")
  const [manualMsg, setManualMsg] = useState("")
  const [manualEntries, setManualEntries] = useState<{ id: string; amount: number; note?: string; created_at: string }[]>([])

  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([])
  const [activeTab, setActiveTab] = useState<"trips" | "tx" | "manual" | "totals" | "vehicle_care">("trips")

  const fetchJson = useCallback(<T,>(path: string) => api<T>(path, { token }), [token])

  useEffect(() => {
    async function loadSaccos() {
      try {
        const res = await fetchJson<{ items?: Sacco[] }>("/u/my-saccos")
        const items = res.items || []
        setSaccos(items)
        if (items.length) setSaccoId(items[0].sacco_id || "")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load SACCOs")
      }
    }
    void loadSaccos()
  }, [fetchJson])

  useEffect(() => {
    if (!saccoId) return
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const [mRes, tRes, rRes] = await Promise.all([
          fetchJson<{ items?: Matatu[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/matatus`),
          fetchJson<{ items?: Tx[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/transactions?limit=500`),
          fetchJson<{ items?: Route[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/routes`).catch(() => ({ items: [] })),
        ])
        const mats = mRes.items || []
        setMatatus(mats)
        if (mats.length) setMatatuId((prev) => prev || mats[0].id || "")
        setTxs(tRes.items || [])
        setRoutes(rRes.items || [])
        if (!routeId && rRes.items?.length) setRouteId(rRes.items[0].id || "")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    void loadData()
  }, [fetchJson, saccoId, routeId])

  useEffect(() => {
    void (async () => {
      try {
        const items = await fetchAccessGrants()
        setAccessGrants(items)
      } catch {
        setAccessGrants([])
      }
    })()
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(manualKey(matatuId))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setManualEntries(parsed)
      } else {
        setManualEntries([])
      }
    } catch {
      setManualEntries([])
    }
  }, [matatuId])

  const filteredTx = useMemo(() => txs.filter((t) => !matatuId || t.matatu_id === matatuId), [txs, matatuId])

  const sums = useMemo(() => {
    let auto = 0
    let manual = 0
    filteredTx.forEach((t) => {
      const kind = (t.kind || "").toUpperCase()
      if (kind === "CASH") manual += Number(t.fare_amount_kes || 0)
      else auto += Number(t.fare_amount_kes || 0)
    })
    const manualLocal = manualEntries.reduce((acc, m) => acc + Number(m.amount || 0), 0)
    return {
      auto,
      manual: manual + manualLocal,
      total: auto + manual + manualLocal,
    }
  }, [filteredTx, manualEntries])
  const ownerScopeId = user?.matatu_id || ""
  const vehicleCareGrant = useMemo(
    () =>
      accessGrants.find(
        (grant) => grant.scope_type === "OWNER" && String(grant.scope_id || "") === String(ownerScopeId || "")
      ) || null,
    [accessGrants, ownerScopeId],
  )
  const hasVehicleCareAccess = Boolean(vehicleCareGrant)
  const canManageVehicleCare = Boolean(vehicleCareGrant?.can_manage_vehicle_care)
  const canManageCompliance = Boolean(vehicleCareGrant?.can_manage_compliance)
  const canViewVehicleCareAnalytics = vehicleCareGrant?.can_view_analytics !== false


  async function recordManualCash() {
    if (!saccoId || !matatuId) {
      setManualMsg("Pick a SACCO and matatu first")
      return
    }
    const amt = Number(manualAmount || 0)
    if (!(amt > 0)) {
      setManualMsg("Enter amount")
      return
    }
    setManualMsg("Saving...")
    try {
      await api("/api/staff/cash", {
        method: "POST",
        body: {
          sacco_id: saccoId,
          matatu_id: matatuId,
          kind: "CASH",
          amount: amt,
          payer_name: manualNote.trim() || "Manual cash entry",
          payer_phone: "",
        },
        token,
      })
      const entry = { id: `MAN_${Date.now()}`, amount: amt, note: manualNote, created_at: new Date().toISOString() }
      const next = [entry, ...manualEntries]
      setManualEntries(next)
      localStorage.setItem(manualKey(matatuId), JSON.stringify(next))
      setManualAmount("")
      setManualNote("")
      setManualMsg("Saved")
    } catch (err) {
      setManualMsg(err instanceof Error ? err.message : "Save failed")
    }
  }

  function refresh() {
    setSaccoId((prev) => `${prev}`)
  }

  const heroRight = user?.role ? `Role: ${user.role}` : "Matatu Staff"

  return (
    <DashboardShell title="Matatu Staff" subtitle="Trips & Cash" hideShellChrome>
      <div className="hero-bar" style={{ marginBottom: 16 }}>
        <div className="hero-left">
          <div className="hero-chip">MATATU STAFF</div>
          <h2 style={{ margin: "6px 0 4px" }}>Trips & Cash</h2>
          <div className="muted">Collect fares and manual cash on active routes</div>
          <div className="hero-inline">
            <span className="sys-pill-lite">{todayKey()}</span>
            <span className="sys-pill-lite">{matatus.length} matatu(s)</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <div className="badge-ghost">{heroRight}</div>
          <button type="button" className="btn ghost" onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      <section className="card" style={{ paddingBottom: 10 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label>
            <div className="muted small">Route</div>
            <select value={routeId} onChange={(e) => setRouteId(e.target.value)} style={{ minWidth: 180, padding: 10 }}>
              {routes.map((r) => (
                <option key={r.id || r.code} value={r.id || r.code || ""}>
                  {r.code ? `${r.code} — ${r.name}` : r.name || r.id}
                </option>
              ))}
              {!routes.length ? <option value="">- no routes -</option> : null}
            </select>
          </label>
          <label>
            <div className="muted small">SACCO</div>
            <select value={saccoId} onChange={(e) => setSaccoId(e.target.value)} style={{ minWidth: 160, padding: 10 }}>
              {saccos.map((s) => (
                <option key={s.sacco_id} value={s.sacco_id || ""}>
                  {s.name || s.sacco_id}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="muted small">Matatu</div>
            <select value={matatuId} onChange={(e) => setMatatuId(e.target.value)} style={{ minWidth: 140, padding: 10 }}>
              {matatus.map((m) => (
                <option key={m.id} value={m.id || ""}>
                  {m.number_plate || m.id}
                </option>
              ))}
              {!matatus.length ? <option value="">- none -</option> : null}
            </select>
          </label>
          <button type="button" className="btn ghost" onClick={refresh}>
            Reload
          </button>
          {loading ? <span className="muted small">Loading…</span> : null}
          {error ? <span className="err">{error}</span> : null}
        </div>
      </section>

      <nav className="sys-nav" aria-label="Matatu staff sections">
        {[
          { id: "trips", label: "Trips" },
          { id: "tx", label: "Transactions" },
          { id: "manual", label: "Manual Cash" },
          { id: "totals", label: "Totals" },
          { id: "vehicle_care", label: "Vehicle Care" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sys-tab${activeTab === t.id ? " active" : ""}`}
            onClick={() => setActiveTab(t.id as typeof activeTab)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === "trips" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Start New Trip</h3>
            <span className="muted small">Route {routeId || "n/a"} • Matatu {matatuId || "n/a"}</span>
          </div>
          <button type="button" className="btn primary" style={{ marginTop: 8, alignSelf: "flex-start" }}>
            Start Trip
          </button>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <h4 style={{ margin: "0 0 6px" }}>Today’s Trips</h4>
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Route</th>
                  <th>Auto (KES)</th>
                  <th>Manual (KES)</th>
                  <th>Total</th>
                  <th>ID</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={7} className="muted">
                    No trips recorded yet. Use “Start Trip” to begin tracking.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "tx" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Transactions (FARE)</h3>
            <button type="button" className="btn ghost" onClick={refresh}>
              Reload
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>MSISDN</th>
                  <th>Kind</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>ID</th>
                </tr>
              </thead>
              <tbody>
                {filteredTx.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No fare transactions in range.
                    </td>
                  </tr>
                ) : (
                  filteredTx.map((tx) => (
                    <tr key={tx.id || tx.created_at}>
                      <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ""}</td>
                      <td className="mono">{tx.msisdn || ""}</td>
                      <td>{tx.kind || ""}</td>
                      <td>{fmtKES(tx.fare_amount_kes)}</td>
                      <td>{tx.status || ""}</td>
                      <td className="mono">{tx.id}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "manual" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Manual Cash Collection</h3>
            <span className="muted small">{manualMsg}</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input
              type="number"
              placeholder="Amount (KES)"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              style={{ width: 180 }}
            />
            <input
              placeholder="Note (optional)"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              style={{ flex: "1 1 260px" }}
            />
            <button type="button" onClick={recordManualCash}>
              Record Cash
            </button>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            Records cash directly against the current matatu without affecting trip states.
          </div>
          {manualEntries.length ? (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Amount</th>
                    <th>Note</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {manualEntries.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.created_at).toLocaleString()}</td>
                      <td>{fmtKES(e.amount)}</td>
                      <td>{e.note || ""}</td>
                      <td className="mono">{e.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "totals" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Current Trip Totals</h3>
            <span className="muted small">Route {routeId || "n/a"} • Matatu {matatuId || "n/a"}</span>
          </div>
          <div className="grid g2" style={{ gap: 12, marginTop: 8 }}>
            <div className="card" style={{ boxShadow: "none" }}>
              <div className="muted small">MPESA (AUTO)</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(sums.auto)}</div>
            </div>
            <div className="card" style={{ boxShadow: "none" }}>
              <div className="muted small">MANUAL CASH</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(sums.manual)}</div>
            </div>
            <div className="card" style={{ boxShadow: "none" }}>
              <div className="muted small">TRIP TOTAL</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(sums.total)}</div>
            </div>
            <div className="card" style={{ boxShadow: "none" }}>
              <div className="muted small">DAILY TOTAL</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(sums.total)}</div>
            </div>
          </div>
        </section>
      ) : null}
      {activeTab === "vehicle_care" ? (
        hasVehicleCareAccess && ownerScopeId ? (
          <VehicleCarePage
            context={{
              scope_type: "OWNER",
              scope_id: ownerScopeId,
              can_manage_vehicle_care: canManageVehicleCare,
              can_manage_compliance: canManageCompliance,
              can_view_analytics: canViewVehicleCareAnalytics,
            }}
          />
        ) : (
          <section className="card">
            <div className="muted">Vehicle Care access is not enabled. Contact your owner.</div>
          </section>
        )
      ) : null}

    </DashboardShell>
  )
}

export default MatatuStaffDashboard
