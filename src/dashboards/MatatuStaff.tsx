import { useCallback, useEffect, useMemo, useState } from "react"
import DashboardShell from "../components/DashboardShell"
import { api } from "../services/api"
import { useAuth } from "../state/auth"
import VehicleCarePage from "../modules/vehicleCare/VehicleCarePage"
import { fetchAccessGrants, type AccessGrant } from "../modules/vehicleCare/vehicleCare.api"

type Sacco = { sacco_id?: string; name?: string }
type Matatu = { id?: string; number_plate?: string; sacco_id?: string; owner_name?: string; owner_phone?: string }
type Route = { id?: string; name?: string; code?: string }
type Tx = {
  id?: string
  created_at?: string
  kind?: string
  status?: string
  matatu_id?: string
  fare_amount_kes?: number
  msisdn?: string
  passenger_msisdn?: string
  notes?: string
  created_by_name?: string
  created_by_email?: string
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
  const [staffName, setStaffName] = useState("")
  const [timeLabel, setTimeLabel] = useState("")

  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([])
  const [activeTab, setActiveTab] = useState<"overview" | "trips" | "transactions" | "vehicle_care">("overview")

  const fetchJson = useCallback(<T,>(path: string) => api<T>(path, { token }), [token])

  const loadTransactions = useCallback(async () => {
    if (!saccoId || !matatuId) {
      setTxs([])
      return
    }
    try {
      const tRes = await fetchJson<{ items?: Tx[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/transactions?limit=500`)
      const items = tRes.items || []
      setTxs(items.filter((t) => t.matatu_id === matatuId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions")
    }
  }, [fetchJson, matatuId, saccoId])

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
    if (user?.matatu_id) {
      setMatatuId(user.matatu_id)
    }
  }, [user?.matatu_id])

  useEffect(() => {
    if (!saccoId) return
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const [mRes, rRes] = await Promise.all([
          fetchJson<{ items?: Matatu[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/matatus`),
          fetchJson<{ items?: Route[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/routes`).catch(() => ({ items: [] })),
        ])
        const mats = mRes.items || []
        setMatatus(mats)
        if (!user?.matatu_id) setMatatuId("")
        setRoutes(rRes.items || [])
        if (!routeId && rRes.items?.length) setRouteId(rRes.items[0].id || "")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    void loadData()
  }, [fetchJson, saccoId, routeId, user?.matatu_id])

  useEffect(() => {
    if (!saccoId) return
    void loadTransactions()
    const timer = setInterval(() => {
      void loadTransactions()
    }, 10000)
    return () => clearInterval(timer)
  }, [loadTransactions, saccoId])

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
    if (!matatuId || !user?.id) {
      setStaffName("")
      return
    }
    void (async () => {
      try {
        const res = await fetchJson<{ items?: Array<{ user_id?: string; name?: string; email?: string }> }>(
          `/u/matatu/${encodeURIComponent(matatuId)}/staff`,
        )
        const items = res.items || []
        const match =
          items.find((s) => s.user_id === user.id) ||
          items.find(
            (s) =>
              s.email &&
              user.email &&
              s.email.toString().trim().toLowerCase() === user.email.toString().trim().toLowerCase(),
          ) ||
          null
        setStaffName(match?.name || "")
      } catch {
        setStaffName("")
      }
    })()
  }, [fetchJson, matatuId, user?.id, user?.email])

  useEffect(() => {
    const updateTime = () => {
      setTimeLabel(
        new Date().toLocaleTimeString("en-KE", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      )
    }
    updateTime()
    const timer = setInterval(updateTime, 60000)
    return () => clearInterval(timer)
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

  const filteredTx = useMemo(() => (matatuId ? txs.filter((t) => t.matatu_id === matatuId) : []), [txs, matatuId])
  const currentMatatu = useMemo(
    () => matatus.find((m) => m.id && m.id === matatuId) || null,
    [matatuId, matatus],
  )
  const currentSacco = useMemo(() => saccos.find((s) => s.sacco_id === saccoId) || null, [saccos, saccoId])
  const operatorLabel = currentSacco?.name || currentSacco?.sacco_id || "Unassigned"
  const assignedMatatuLabel = useMemo(() => {
    if (currentMatatu?.number_plate) return currentMatatu.number_plate
    if (currentMatatu?.id) return currentMatatu.id
    if (matatuId) return matatuId
    return "Unassigned"
  }, [currentMatatu, matatuId])
  const assignedMatatuCount = matatuId ? 1 : 0

  const transactionTotals = useMemo(() => {
    const manualLocal = manualEntries.reduce((acc, m) => acc + Number(m.amount || 0), 0)
    let manualCash = 0
    let dailyFee = 0
    let savings = 0
    let loans = 0
    filteredTx.forEach((t) => {
      const kind = (t.kind || "").toUpperCase()
      const amount = Number(t.fare_amount_kes || 0)
      if (kind === "CASH") manualCash += amount
      if (kind === "SACCO_FEE" || kind === "DAILY_FEE") dailyFee += amount
      if (kind === "SAVINGS") savings += amount
      if (kind === "LOAN_REPAY") loans += amount
    })
    const manualTotal = manualCash + manualLocal
    const accountTotal = dailyFee + savings + loans
    return {
      manualCash: manualTotal,
      dailyFee,
      savings,
      loans,
      accountTotal,
      collectedTotal: manualTotal + accountTotal,
    }
  }, [filteredTx, manualEntries])

  const liveTxs = useMemo(() => filteredTx.slice(0, 12), [filteredTx])
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
      setManualMsg("Missing SACCO or assigned matatu")
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
    void loadTransactions()
  }

  const staffLabel = staffName || user?.name || (user?.email ? user.email.split("@")[0] : "") || "Staff"
  const heroRight = user?.role ? `Role: ${user.role}` : "Matatu Staff"

  return (
    <DashboardShell title="Matatu Staff" subtitle="Staff Dashboard" hideShellChrome>
      <div className="hero-bar" style={{ marginBottom: 16 }}>
        <div className="hero-left">
          <div className="hero-chip">MATATU STAFF</div>
          <h2 style={{ margin: "6px 0 4px" }}>Hello, {staffLabel}</h2>
          <div className="muted">Staff dashboard overview</div>
          <div className="hero-inline">
            <span className="sys-pill-lite">Operate Under: {operatorLabel}</span>
            <span className="sys-pill-lite">{todayKey()}</span>
            <span className="sys-pill-lite">{timeLabel}</span>
            <span className="sys-pill-lite">{assignedMatatuCount} matatu(s)</span>
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
                  {r.code ? `${r.code} - ${r.name}` : r.name || r.id}
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
            <div className="muted small">Assigned Matatu</div>
            <input className="input" value={assignedMatatuLabel} readOnly style={{ minWidth: 160 }} />
          </label>
          <button type="button" className="btn ghost" onClick={refresh}>
            Reload
          </button>
          {loading ? <span className="muted small">Loading...</span> : null}
          {error ? <span className="err">{error}</span> : null}
        </div>
      </section>

      <nav className="sys-nav" aria-label="Matatu staff sections">
        {[
          { id: "overview", label: "Overview" },
          { id: "trips", label: "Trips" },
          { id: "transactions", label: "Transactions" },
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

      {activeTab === "overview" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Live payments</h3>
            <span className="muted small">Auto-refresh every 10 seconds</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {liveTxs.length === 0 ? (
              <div className="muted small">No payments yet.</div>
            ) : (
              liveTxs.map((tx) => {
                const name =
                  (tx.notes || "").trim() ||
                  (tx.created_by_name || "").trim() ||
                  (tx.created_by_email || "").trim() ||
                  "Payer"
                const phone = tx.passenger_msisdn || tx.msisdn || "-"
                return (
                  <div key={tx.id || tx.created_at} className="card" style={{ boxShadow: "none", border: "1px solid #e5e7eb" }}>
                    <div className="row" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{name}</div>
                        <div className="muted small">
                          {phone} {tx.created_at ? `- ${new Date(tx.created_at).toLocaleTimeString()}` : ""}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{fmtKES(tx.fare_amount_kes)}</div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "trips" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Trips</h3>
            <span className="muted small">Route {routeId || "n/a"} - Matatu {assignedMatatuLabel}</span>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn primary">
              Start Trip
            </button>
            <button type="button" className="btn ghost">
              End Trip
            </button>
            <span className="muted small">Start and end trips for the selected route.</span>
          </div>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <h4 style={{ margin: "0 0 6px" }}>Today's Trips</h4>
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
                    No trips recorded yet. Use "Start Trip" to begin tracking.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "transactions" ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Collections summary</h3>
              <button type="button" className="btn ghost" onClick={refresh}>
                Reload
              </button>
            </div>
            <div className="grid g3" style={{ gap: 12, marginTop: 8 }}>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Manual cash collected</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(transactionTotals.manualCash)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Account deductions</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(transactionTotals.accountTotal)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Total collected</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(transactionTotals.collectedTotal)}</div>
              </div>
            </div>
            <div className="grid g3" style={{ gap: 12, marginTop: 12 }}>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Daily fee deducted</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.dailyFee)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Savings deducted</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.savings)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Loan repayments</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.loans)}</div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Manual cash entry</h3>
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

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Transactions</h3>
              <span className="muted small">{filteredTx.length} record(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Payer</th>
                    <th>Phone</th>
                    <th>Kind</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTx.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        No transactions in range.
                      </td>
                    </tr>
                  ) : (
                    filteredTx.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ""}</td>
                        <td>{(tx.notes || "").trim() || tx.created_by_name || tx.created_by_email || "-"}</td>
                        <td className="mono">{tx.passenger_msisdn || tx.msisdn || "-"}</td>
                        <td>{tx.kind || ""}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ""}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
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
