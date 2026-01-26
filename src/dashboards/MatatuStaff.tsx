import { useCallback, useEffect, useMemo, useState } from "react"
import { NavLink } from "react-router-dom"
import DashboardShell from "../components/DashboardShell"
import { authFetch } from "../lib/auth"
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
type LedgerRow = {
  id?: string
  wallet_id?: string
  direction?: "CREDIT" | "DEBIT" | string
  amount?: number
  balance_before?: number
  balance_after?: number
  entry_type?: string
  reference_type?: string
  reference_id?: string
  description?: string | null
  created_at?: string
}
type LedgerWallet = {
  wallet_id?: string
  wallet_kind?: string
  virtual_account_code?: string
  balance?: number
  total?: number
  items?: LedgerRow[]
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
  const ledgerStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const ledgerEnd = new Date().toISOString().slice(0, 10)
  const [wallets, setWallets] = useState<LedgerWallet[]>([])
  const [walletError, setWalletError] = useState<string | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [ledgerFrom, setLedgerFrom] = useState(ledgerStart)
  const [ledgerTo, setLedgerTo] = useState(ledgerEnd)

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

  const loadWallets = useCallback(async () => {
    if (!matatuId) {
      setWallets([])
      setWalletError("No matatu assigned yet — contact SACCO admin.")
      return
    }
    setWalletLoading(true)
    setWalletError(null)
    try {
      const params = new URLSearchParams()
      params.set("limit", "100")
      if (ledgerFrom) params.set("from", ledgerFrom)
      if (ledgerTo) params.set("to", ledgerTo)
      params.set("matatu_id", matatuId)
      const res = await authFetch(`/api/wallets/owner-ledger?${params.toString()}`, {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        let msg = "Failed to load wallets"
        try {
          const body = await res.json()
          if (res.status === 403 && (body?.code === "MATATU_ACCESS_DENIED" || body?.code === "SACCO_SCOPE_MISMATCH")) {
            msg = "No matatu assignment found for this account. Contact SACCO admin."
          }
        } catch {
          const text = await res.text()
          msg = text || msg
        }
        setWalletError(msg)
        setWallets([])
        return
      }
      const data = (await res.json()) as any
      setWallets(data.wallets || [])
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Failed to load wallets")
      setWallets([])
    } finally {
      setWalletLoading(false)
    }
  }, [fetchJson, ledgerFrom, ledgerTo, matatuId])

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
    if (activeTab === "overview") {
      void loadWallets()
    }
  }, [activeTab, loadTransactions, loadWallets, saccoId])

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
    <DashboardShell title="Matatu Staff" subtitle="Staff Dashboard" navLabel="Matatu navigation" hideShellChrome>
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
        <>
          <section className="card">
              <div className="topline" style={{ flexWrap: "wrap", gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>Wallets</h3>
                <div className="muted small">Owner + vehicle wallets</div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <label className="muted small">
                  From
                  <input type="date" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)} />
                </label>
                <label className="muted small">
                  To
                  <input type="date" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)} />
                </label>
                <button className="btn" type="button" onClick={() => loadWallets()}>
                  Refresh
                </button>
                {walletLoading ? <span className="muted small">Loading...</span> : null}
                {walletError ? <span className="err">{walletError}</span> : null}
              </div>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
              {wallets.length === 0 ? (
                <div className="muted small">No wallet entries yet.</div>
              ) : (
                wallets.map((wallet) => {
                  const rows = (wallet.items || []).slice(0, 10)
                  return (
                    <div
                      key={wallet.wallet_id || wallet.wallet_kind}
                      className="table-wrap"
                      style={{ border: "1px solid #e2e8f0", borderRadius: 8 }}
                    >
                      <div className="topline" style={{ padding: "8px 12px" }}>
                        <div>
                          <div className="muted small">{wallet.wallet_kind || "Wallet"}</div>
                          <strong>{fmtKES(wallet.balance)}</strong>
                          <div className="muted small">Account: {wallet.virtual_account_code || "-"}</div>
                        </div>
                        <span className="muted small">Entries: {wallet.total || rows.length}</span>
                      </div>
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="muted">
                                No ledger rows.
                              </td>
                            </tr>
                          ) : (
                            rows.map((row) => (
                              <tr key={row.id || row.created_at}>
                                <td className="muted small">
                                  {row.created_at ? new Date(row.created_at).toLocaleTimeString() : "-"}
                                </td>
                                <td>{row.entry_type || row.direction || ""}</td>
                                <td style={{ color: (row.direction || "").toUpperCase() === "CREDIT" ? "#15803d" : "#b91c1c" }}>
                                  {fmtKES(row.amount)}
                                </td>
                                <td>{fmtKES(row.balance_after)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                })
              )}
            </div>
          </section>

          <section className="card">
            <div className="topline" style={{ alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0 }}>Live payments</h3>
                <div className="muted small">View real-time C2B payments for this matatu.</div>
              </div>
              <NavLink className="btn" to="/matatu/live-payments">
                Open live feed
              </NavLink>
            </div>
          </section>
        </>
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
