import { useEffect, useMemo, useState } from "react"
import DashboardShell from "../components/DashboardShell"
import PaybillCodeCard from "../components/PaybillCodeCard"
import PaybillHeader from "../components/PaybillHeader"
import { authFetch } from "../lib/auth"
import { mapPaybillCodes, PAYBILL_NUMBER, type PaybillAliasRow } from "../lib/paybill"
import { useAuth } from "../state/auth"
import { useEntityWallet } from "../hooks/useEntityWallet"
import VehicleCarePage from "../modules/vehicleCare/VehicleCarePage"
import { fetchAccessGrants, type AccessGrant } from "../modules/vehicleCare/vehicleCare.api"

type Summary = {
  till_today?: number
  cash_today?: number
  expenses_today?: number
  net_today?: number
}

type InsightTotals = {
  income?: number
  expenses?: number
  net?: number
  expense_pct_of_income?: number
}

type InsightRow = {
  date?: string
  income?: number
  expenses?: number
  net?: number
}

type CashRow = {
  created_at?: string
  time?: string
  timestamp?: string
  payer_name?: string
  phone?: string
  amount?: number
}

type ExpenseRow = {
  created_at?: string
  time?: string
  timestamp?: string
  category?: string
  amount?: number
  notes?: string
}

type Settings = {
  monthly_savings_target_kes?: number
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return (await res.json()) as T
}

const formatKes = (val?: number | null) => `KES ${(Number(val || 0)).toLocaleString("en-KE")}`

const BodaDashboard = () => {
  const { user, logout } = useAuth()

  const [summary, setSummary] = useState<Summary | null>(null)
  const [paybillAliases, setPaybillAliases] = useState<PaybillAliasRow[]>([])
  const [paybillError, setPaybillError] = useState<string | null>(null)
  const [weekTotals, setWeekTotals] = useState<InsightTotals | null>(null)
  const [monthTotals, setMonthTotals] = useState<InsightTotals | null>(null)
  const [trend, setTrend] = useState<InsightRow[]>([])
  const [expCats, setExpCats] = useState<Array<{ category?: string; amount?: number }>>([])

  const [cashRecent, setCashRecent] = useState<CashRow[]>([])
  const [cashSearch, setCashSearch] = useState<CashRow[]>([])
  const [cashFrom, setCashFrom] = useState("")
  const [cashTo, setCashTo] = useState("")

  const [expRecent, setExpRecent] = useState<ExpenseRow[]>([])
  const [expSearch, setExpSearch] = useState<ExpenseRow[]>([])
  const [expFrom, setExpFrom] = useState("")
  const [expTo, setExpTo] = useState("")

  const [cashForm, setCashForm] = useState({ amount: "", payer_name: "", phone: "", notes: "" })
  const [cashMsg, setCashMsg] = useState("")
  const [expForm, setExpForm] = useState({ category: "Fuel", amount: "", notes: "" })
  const [expMsg, setExpMsg] = useState("")

  const [target, setTarget] = useState<number | "">("")
  const [targetMsg, setTargetMsg] = useState("")
  const [targetSummary, setTargetSummary] = useState("Enter a monthly savings target to track progress.")
  const [error, setError] = useState<string | null>(null)
  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([])
  const [activeTab, setActiveTab] = useState<"today" | "cash" | "expenses" | "insights" | "goals" | "automation" | "vehicle_care">("today")

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const weekStartISO = useMemo(() => {
    const d = new Date()
    const dow = d.getDay() || 7
    d.setDate(d.getDate() - (dow - 1))
    return d.toISOString().slice(0, 10)
  }, [])
  const monthStartISO = useMemo(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  }, [])
  const paybillCodes = useMemo(() => mapPaybillCodes(paybillAliases), [paybillAliases])
  const { wallet: bodaWallet, loading: walletLoading, error: walletError } = useEntityWallet("boda")
  const paybillNumber = bodaWallet?.paybill || PAYBILL_NUMBER
  const accountNumber = bodaWallet?.account_number || bodaWallet?.wallet_code || paybillCodes.rider || ""
  const bodaId = user?.boda_id || user?.matatu_id

  const filterToday = (rows: Array<{ created_at?: string; time?: string; timestamp?: string }>) => {
    const today = new Date()
    const start = new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z").getTime()
    const end = start + 24 * 3600 * 1000
    return rows.filter((r) => {
      const t = r.created_at || r.time || r.timestamp
      if (!t) return false
      const x = new Date(t).getTime()
      return x >= start && x < end
    })
  }

  useEffect(() => {
    async function loadAll() {
      setError(null)
      try {
        const [sumRes, weekRes, monthRes] = await Promise.all([
          fetchJson<Summary>(`/api/boda/summary?date=${todayISO}`),
          fetchJson<{ totals?: InsightTotals; trend?: InsightRow[] }>(`/api/boda/insights?start=${weekStartISO}&end=${todayISO}`),
          fetchJson<{ totals?: InsightTotals; expenses?: { categories?: Array<{ category?: string; amount?: number }> } }>(
            `/api/boda/insights?start=${monthStartISO}&end=${todayISO}`,
          ),
        ])
        setSummary(sumRes)
        setWeekTotals(weekRes?.totals || null)
        setTrend(weekRes?.trend || [])
        setMonthTotals(monthRes?.totals || null)
        setExpCats(monthRes?.expenses?.categories || [])

        const cashRes = await fetchJson<{ items?: CashRow[] }>("/api/boda/cash?limit=200")
        setCashRecent(filterToday(cashRes.items || []))

        const expRes = await fetchJson<{ items?: ExpenseRow[] }>("/api/boda/expenses?limit=200")
        setExpRecent(filterToday(expRes.items || []))

        const settingsRes = await fetchJson<Settings>("/api/boda/settings")
        const tgt = Number(settingsRes?.monthly_savings_target_kes || 0)
        setTarget(tgt || "")
        updateTargetSummary(tgt, monthRes?.totals?.net)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed")
      }
    }
    void loadAll()
  }, [todayISO, weekStartISO, monthStartISO])

  useEffect(() => {
    const entityId = bodaId || ""
    if (!entityId) {
      setPaybillAliases([])
      setPaybillError(null)
      return
    }
    async function loadPaybillCodes() {
      try {
        const res = await fetchJson<{ items?: PaybillAliasRow[] }>(
          `/u/paybill-codes?entity_type=BODA&entity_id=${encodeURIComponent(entityId)}`,
        )
        setPaybillAliases(res.items || [])
        setPaybillError(null)
      } catch (err) {
        setPaybillAliases([])
        setPaybillError(err instanceof Error ? err.message : "Failed to load PayBill code")
      }
    }
    loadPaybillCodes()
  }, [bodaId])

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
    updateTargetSummary(target ? Number(target) : 0, monthTotals?.net)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthTotals?.net])

  const ownerScopeId = bodaId || ""
  const operatorGrant = useMemo(
    () => accessGrants.find((grant) => grant.scope_type === "OPERATOR" && grant.is_active !== false) || null,
    [accessGrants],
  )
  const vehicleCareScopeType = operatorGrant?.scope_id ? "OPERATOR" : "OWNER"
  const vehicleCareScopeId = (operatorGrant?.scope_id as string) || ownerScopeId
  const canManageVehicleCare = operatorGrant ? Boolean(operatorGrant.can_manage_vehicle_care) : true
  const canManageCompliance = operatorGrant ? Boolean(operatorGrant.can_manage_compliance) : true
  const canViewVehicleCareAnalytics = operatorGrant ? operatorGrant.can_view_analytics !== false : true
  const hasVehicleCareAccess = Boolean(vehicleCareScopeId)

  async function saveCash() {
    if (!cashForm.amount) {
      setCashMsg("Enter amount")
      return
    }
    setCashMsg("Saving...")
    try {
      await authFetch("/api/boda/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(cashForm.amount),
          payer_name: cashForm.payer_name || undefined,
          phone: cashForm.phone || undefined,
          notes: cashForm.notes || undefined,
        }),
      })
      setCashMsg("Cash saved")
      setCashForm({ amount: "", payer_name: "", phone: "", notes: "" })
      const cashRes = await fetchJson<{ items?: CashRow[] }>("/api/boda/cash?limit=200")
      setCashRecent(filterToday(cashRes.items || []))
    } catch (err) {
      setCashMsg(err instanceof Error ? err.message : "Save failed")
    }
  }

  async function searchCash() {
    const params = new URLSearchParams()
    if (cashFrom) params.set("from", cashFrom)
    if (cashTo) params.set("to", cashTo)
    try {
      const data = await fetchJson<{ items?: CashRow[] }>(`/api/boda/cash?${params.toString()}`)
      setCashSearch(data.items || [])
    } catch (err) {
      setCashSearch([])
      setCashMsg(err instanceof Error ? err.message : "Search failed")
    }
  }

  async function saveExpense() {
    if (!expForm.amount) {
      setExpMsg("Enter amount")
      return
    }
    setExpMsg("Saving...")
    try {
      await authFetch("/api/boda/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: expForm.category || "Other",
          amount: Number(expForm.amount),
          notes: expForm.notes || undefined,
        }),
      })
      setExpMsg("Expense saved")
      setExpForm({ category: "Fuel", amount: "", notes: "" })
      const expRes = await fetchJson<{ items?: ExpenseRow[] }>("/api/boda/expenses?limit=200")
      setExpRecent(filterToday(expRes.items || []))
    } catch (err) {
      setExpMsg(err instanceof Error ? err.message : "Save failed")
    }
  }

  function updateTargetSummary(rawTarget?: number | null, net?: number | null) {
    const targetVal = Number(rawTarget || target || 0)
    const monthNet = Number(net ?? monthTotals?.net ?? 0)
    if (!targetVal) {
      setTargetSummary("No savings target set. Enter a monthly goal to track progress.")
      return
    }
    const now = new Date()
    const year = now.getFullYear()
    const monthIndex = now.getMonth()
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
    const todayDay = now.getDate()
    const remainingDays = Math.max(0, daysInMonth - todayDay)
    const remainingTarget = Math.max(0, targetVal - monthNet)
    if (remainingTarget <= 0) {
      setTargetSummary(`Great! Net income this month (${formatKes(monthNet)}) meets or exceeds your target (${formatKes(targetVal)}).`)
      return
    }
    const perDay = remainingDays > 0 ? remainingTarget / remainingDays : remainingTarget
    const progressPct = targetVal ? Math.round((monthNet / targetVal) * 100) : 0
    setTargetSummary(
      `Target: ${formatKes(targetVal)}. Net so far: ${formatKes(monthNet)} (${Number.isFinite(progressPct) ? progressPct : 0}% of target). ${
        remainingDays > 0
          ? `You need about ${formatKes(perDay)} net per day for the remaining ${remainingDays} day(s) to hit the target.`
          : "This month is ending; any extra net will help close the gap."
      }`,
    )
  }

  async function saveTarget() {
    const raw = Number(target || 0)
    if (!raw) {
      setTargetMsg("Enter target amount")
      return
    }
    setTargetMsg("Saving target...")
    try {
      const data = await fetchJson<Settings>("/api/boda/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_savings_target_kes: raw }),
      })
      const val = Number(data?.monthly_savings_target_kes || raw)
      setTarget(val || "")
      setTargetMsg("Target saved")
      updateTargetSummary(val, monthTotals?.net)
    } catch (err) {
      setTargetMsg(err instanceof Error ? err.message : "Save failed")
    }
  }

  async function searchExpenses() {
    const params = new URLSearchParams()
    if (expFrom) params.set("from", expFrom)
    if (expTo) params.set("to", expTo)
    try {
      const data = await fetchJson<{ items?: ExpenseRow[] }>(`/api/boda/expenses?${params.toString()}`)
      setExpSearch(data.items || [])
    } catch (err) {
      setExpSearch([])
      setExpMsg(err instanceof Error ? err.message : "Search failed")
    }
  }

  return (
    <DashboardShell title="BodaBoda Console" subtitle="Cash, expenses, insights" hideShellChrome>
      {error ? <div className="card err">Error: {error}</div> : null}

      <div className="hero-bar" style={{ marginBottom: 12 }}>
        <div className="hero-left">
          <div className="hero-chip">BODA CONSOLE</div>
          <h2 style={{ margin: "6px 0 4px" }}>BodaBoda Console</h2>
          <div className="muted">Track daily cash, expenses and savings goals.</div>
          <div className="hero-inline">
            <span className="sys-pill-lite">{todayISO}</span>
            <span className="sys-pill-lite">Cash & expenses</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <button type="button" className="btn ghost" onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      <nav className="sys-nav" aria-label="Boda sections">
        {[
          { id: "today", label: "Today" },
          { id: "cash", label: "Cash In" },
          { id: "expenses", label: "Expenses" },
          { id: "insights", label: "Insights" },
          { id: "goals", label: "Goals" },
          { id: "automation", label: "Automation" },
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

      {activeTab === "today" ? (
        <>
          <section className="card">
            <PaybillHeader title={`Boda PayBill Account (${paybillNumber || "—"})`} />
            {paybillError ? <div className="err">PayBill load error: {paybillError}</div> : null}
            {walletError ? <div className="err">Wallet: {walletError}</div> : null}
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <PaybillCodeCard title="PayBill Number" label="PAYBILL" code={paybillNumber || "—"} />
              <PaybillCodeCard title="Boda Rider Account" label="BODA Account (Rider)" code={accountNumber || "—"} />
              <div className="muted small" style={{ marginTop: -4 }}>
                {walletLoading ? "Loading wallet..." : `PayBill code: ${paybillNumber || "—"} · Account number: ${accountNumber || "—"}`}
              </div>
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Today</h3>
            <div className="grid metrics">
              <div className="metric">
                <div className="k">Paybill collection (wallet)</div>
                <div className="v">{walletLoading ? "…" : formatKes(bodaWallet?.balance ?? summary?.till_today)}</div>
              </div>
              <div className="metric">
                <div className="k">Cash today (KSH)</div>
                <div className="v">{formatKes(summary?.cash_today)}</div>
              </div>
              <div className="metric">
                <div className="k">Expenses today</div>
                <div className="v">{formatKes(summary?.expenses_today)}</div>
              </div>
              <div className="metric">
                <div className="k">Net today</div>
                <div className="v">{formatKes(summary?.net_today)}</div>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === "cash" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Cash In</h3>
            <span className="muted small">{cashMsg}</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Amount (KES)"
              type="number"
              value={cashForm.amount}
              onChange={(e) => setCashForm((f) => ({ ...f, amount: e.target.value }))}
              style={{ maxWidth: 160 }}
            />
            <input
              className="input"
              placeholder="Payer name"
              value={cashForm.payer_name}
              onChange={(e) => setCashForm((f) => ({ ...f, payer_name: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Phone"
              value={cashForm.phone}
              onChange={(e) => setCashForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Notes (optional)"
              value={cashForm.notes}
              onChange={(e) => setCashForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <button className="btn" type="button" onClick={saveCash}>
              Save Cash
            </button>
          </div>

          <h4 style={{ marginTop: 16 }}>Recent Cash (today)</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {cashRecent.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No cash today.
                    </td>
                  </tr>
                ) : (
                  cashRecent.map((r, idx) => (
                    <tr key={r.created_at || r.time || idx}>
                      <td>{r.created_at || r.time || ""}</td>
                      <td>{r.payer_name || ""}</td>
                      <td>{r.phone || ""}</td>
                      <td>{formatKes(r.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h4 style={{ marginTop: 16 }}>Search History</h4>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="muted small">
              From
              <input type="date" value={cashFrom} onChange={(e) => setCashFrom(e.target.value)} />
            </label>
            <label className="muted small">
              To
              <input type="date" value={cashTo} onChange={(e) => setCashTo(e.target.value)} />
            </label>
            <button className="btn ghost" type="button" onClick={searchCash}>
              Search
            </button>
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {cashSearch.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No search yet.
                    </td>
                  </tr>
                ) : (
                  cashSearch.map((r, idx) => (
                    <tr key={r.created_at || r.time || idx}>
                      <td>{r.created_at || r.time || ""}</td>
                      <td>{r.payer_name || ""}</td>
                      <td>{r.phone || ""}</td>
                      <td>{formatKes(r.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "expenses" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Expenses</h3>
            <span className="muted small">{expMsg}</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select
              value={expForm.category}
              onChange={(e) => setExpForm((f) => ({ ...f, category: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="Fuel">Fuel</option>
              <option value="Parking">Parking</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Airtime">Airtime</option>
              <option value="Food">Food</option>
              <option value="Liquor">Liquor</option>
              <option value="Other">Other</option>
            </select>
            <input
              className="input"
              placeholder="Amount (KES)"
              type="number"
              value={expForm.amount}
              onChange={(e) => setExpForm((f) => ({ ...f, amount: e.target.value }))}
              style={{ maxWidth: 160 }}
            />
            <input
              className="input"
              placeholder="Notes"
              value={expForm.notes}
              onChange={(e) => setExpForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <button className="btn" type="button" onClick={saveExpense}>
              Save Expense
            </button>
          </div>

          <h4 style={{ marginTop: 16 }}>Recent Expenses (today)</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {expRecent.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No expenses today.
                    </td>
                  </tr>
                ) : (
                  expRecent.map((r, idx) => (
                    <tr key={r.created_at || r.time || idx}>
                      <td>{r.created_at || r.time || ""}</td>
                      <td>{r.category || ""}</td>
                      <td>{formatKes(r.amount)}</td>
                      <td>{r.notes || ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h4 style={{ marginTop: 16 }}>Search Expenses</h4>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="muted small">
              From
              <input type="date" value={expFrom} onChange={(e) => setExpFrom(e.target.value)} />
            </label>
            <label className="muted small">
              To
              <input type="date" value={expTo} onChange={(e) => setExpTo(e.target.value)} />
            </label>
            <button className="btn ghost" type="button" onClick={searchExpenses}>
              Search
            </button>
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {expSearch.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No search yet.
                    </td>
                  </tr>
                ) : (
                  expSearch.map((r, idx) => (
                    <tr key={r.created_at || r.time || idx}>
                      <td>{r.created_at || r.time || ""}</td>
                      <td>{r.category || ""}</td>
                      <td>{formatKes(r.amount)}</td>
                      <td>{r.notes || ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "insights" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Insights</h3>
          </div>
          <div className="grid metrics">
            <div className="metric">
              <div className="k">This week (KSH)</div>
              <div className="v">{formatKes(weekTotals?.net)}</div>
              <div className="muted small">Income {formatKes(weekTotals?.income)} · Expenses {formatKes(weekTotals?.expenses)}</div>
            </div>
            <div className="metric">
              <div className="k">This month (KSH)</div>
              <div className="v">{formatKes(monthTotals?.net)}</div>
              <div className="muted small">Income {formatKes(monthTotals?.income)} · Expenses {formatKes(monthTotals?.expenses)}</div>
            </div>
            <div className="metric">
              <div className="k">Expense ratio</div>
              <div className="v">
                {monthTotals?.expense_pct_of_income != null
                  ? `${Math.round(Number(monthTotals.expense_pct_of_income || 0))}%`
                  : "—"}
              </div>
              <div className="muted small">Expenses as % of income (month)</div>
            </div>
          </div>

          <h4 style={{ marginTop: 12 }}>Expense Insights (last 30 days)</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Amount (KSH)</th>
                  <th>% of expenses</th>
                </tr>
              </thead>
              <tbody>
                {expCats.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No expenses recorded in the last 30 days.
                    </td>
                  </tr>
                ) : (
                  expCats.map((c, idx) => {
                    const total = expCats.reduce((sum, row) => sum + Number(row.amount || 0), 0) || 1
                    const amt = Number(c.amount || 0)
                    const pct = Math.round((amt / total) * 100)
                    return (
                      <tr key={c.category || idx}>
                        <td>{c.category || "?"}</td>
                        <td>{formatKes(amt)}</td>
                        <td>{pct}%</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <h4 style={{ marginTop: 12 }}>Trend (last 7 days)</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Income</th>
                  <th>Expenses</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {trend.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No recent data.
                    </td>
                  </tr>
                ) : (
                  trend.map((row, idx) => (
                    <tr key={row.date || idx}>
                      <td>{row.date || ""}</td>
                      <td>{formatKes(row.income)}</td>
                      <td>{formatKes(row.expenses)}</td>
                      <td>{formatKes(row.net)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "goals" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Goals</h3>
            <span className="muted small">{targetMsg}</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label>
              <div className="muted small">Monthly savings target (KES)</div>
              <input
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}
                placeholder="e.g. 20000"
                style={{ minWidth: 180 }}
              />
            </label>
            <button type="button" onClick={saveTarget}>
              Save Target
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {targetSummary}
          </p>
        </section>
      ) : null}

      {activeTab === "automation" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Automation</h3>
          </div>
          <p className="muted">Mobile app automation has been retired. Use this web dashboard to record cash and expenses.</p>
        </section>
      ) : null}
      {activeTab === "vehicle_care" ? (
        hasVehicleCareAccess && vehicleCareScopeId ? (
          <VehicleCarePage
            context={{
              scope_type: vehicleCareScopeType,
              scope_id: vehicleCareScopeId,
              can_manage_vehicle_care: canManageVehicleCare,
              can_manage_compliance: canManageCompliance,
              can_view_analytics: canViewVehicleCareAnalytics,
              default_asset_type: "BODA",
              asset_type_options: ["BODA"],
            }}
          />
        ) : (
          <section className="card">
            <div className="muted">Vehicle Care access is not enabled.</div>
          </section>
        )
      ) : null}

    </DashboardShell>
  )
}

export default BodaDashboard

