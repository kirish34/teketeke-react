import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'
import { api } from '../services/api'
import { useAuth } from '../state/auth'
import VehicleCarePage from '../modules/vehicleCare/VehicleCarePage'
import { fetchAccessGrants, type AccessGrant } from '../modules/vehicleCare/vehicleCare.api'

type Sacco = { sacco_id?: string; name?: string }
type Matatu = {
  id?: string
  number_plate?: string
  sacco_id?: string
  owner_name?: string
  owner_phone?: string
  savings_opt_in?: boolean
}
type Loan = { id?: string; matatu_id?: string; borrower_name?: string; status?: string; principal_kes?: number }
type Tx = {
  id?: string
  created_at?: string
  kind?: string
  status?: string
  matatu_id?: string
  fare_amount_kes?: number
}

const fmtKES = (val?: number | null) => `KES ${(Number(val || 0)).toLocaleString('en-KE')}`
const todayKey = () => new Date().toISOString().slice(0, 10)

type PaidInfo = { total: number; last_at: string }

function buildPaidMap(txs: Tx[], kinds: string[]) {
  const kindSet = new Set(kinds.map((k) => k.toUpperCase()))
  const map = new Map<string, PaidInfo>()
  txs.forEach((t) => {
    const kind = (t.kind || '').toUpperCase()
    if (!kindSet.has(kind)) return
    const id = t.matatu_id || ''
    if (!id) return
    const amount = Number(t.fare_amount_kes || 0)
    const lastAt = t.created_at || ''
    const existing = map.get(id)
    if (!existing) {
      map.set(id, { total: amount, last_at: lastAt })
      return
    }
    const nextTotal = existing.total + amount
    const nextLast = existing.last_at && lastAt && existing.last_at > lastAt ? existing.last_at : lastAt
    map.set(id, { total: nextTotal, last_at: nextLast })
  })
  return map
}

const SaccoStaffDashboard = () => {
  const { token, user, logout } = useAuth()

  const [saccos, setSaccos] = useState<Sacco[]>([])
  const [matatus, setMatatus] = useState<Matatu[]>([])
  const [loans, setLoans] = useState<Loan[]>([])
  const [saccoId, setSaccoId] = useState('')
  const [matatuId, setMatatuId] = useState('')

  const [txs, setTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dailyAmount, setDailyAmount] = useState('')
  const [dailyNote, setDailyNote] = useState('')
  const [dailyMsg, setDailyMsg] = useState('')
  const [loanAmount, setLoanAmount] = useState('')
  const [loanNote, setLoanNote] = useState('')
  const [loanMsg, setLoanMsg] = useState('')
  const [savingsAmount, setSavingsAmount] = useState('')
  const [savingsNote, setSavingsNote] = useState('')
  const [savingsMsg, setSavingsMsg] = useState('')
  const [staffName, setStaffName] = useState('')
  const [timeLabel, setTimeLabel] = useState('')

  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([])
  const [activeTab, setActiveTab] = useState<'daily' | 'loans' | 'savings' | 'vehicle_care'>('daily')

  const fetchJson = useCallback(<T,>(path: string) => api<T>(path, { token }), [token])

  useEffect(() => {
    async function loadSaccos() {
      try {
        const res = await fetchJson<{ items?: Sacco[] }>('/u/my-saccos')
        const items = res.items || []
        setSaccos(items)
        if (items.length) setSaccoId(items[0].sacco_id || '')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load SACCOs')
      }
    }
    void loadSaccos()
  }, [fetchJson])

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
    if (!saccoId) return
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const [mRes, tRes, lRes] = await Promise.all([
          fetchJson<{ items?: Matatu[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/matatus`),
          fetchJson<{ items?: Tx[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/transactions?limit=500`),
          fetchJson<{ items?: Loan[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/loans`).catch(() => ({ items: [] })),
        ])
        const mats = mRes.items || []
        setMatatus(mats)
        if (mats.length) setMatatuId((prev) => prev || (mats[0].id || ''))
        setTxs(tRes.items || [])
        setLoans(lRes.items || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    void loadData()
  }, [fetchJson, saccoId])

  useEffect(() => {
    if (!saccoId || !user?.id) {
      setStaffName('')
      return
    }
    void (async () => {
      try {
        const res = await fetchJson<{ items?: Array<{ user_id?: string; name?: string; email?: string }> }>(
          `/u/sacco/${encodeURIComponent(saccoId)}/staff`,
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
        setStaffName(match?.name || '')
      } catch {
        setStaffName('')
      }
    })()
  }, [fetchJson, saccoId, user?.email, user?.id])

  useEffect(() => {
    const updateTime = () => {
      setTimeLabel(
        new Date().toLocaleTimeString('en-KE', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      )
    }
    updateTime()
    const timer = setInterval(updateTime, 60000)
    return () => clearInterval(timer)
  }, [])

  const todayIso = todayKey()
  const todayTxs = useMemo(
    () => txs.filter((t) => (t.created_at || '').slice(0, 10) === todayIso),
    [txs, todayIso],
  )

  const dailyPaidMap = useMemo(() => buildPaidMap(todayTxs, ['SACCO_FEE', 'DAILY_FEE']), [todayTxs])
  const savingsPaidMap = useMemo(() => buildPaidMap(todayTxs, ['SAVINGS']), [todayTxs])
  const loanPaidMap = useMemo(() => buildPaidMap(todayTxs, ['LOAN_REPAY']), [todayTxs])

  const savingsMatatus = useMemo(() => matatus.filter((m) => m.savings_opt_in), [matatus])
  const activeLoans = useMemo(
    () => loans.filter((l) => (l.status || '').toUpperCase() === 'ACTIVE' && l.matatu_id),
    [loans],
  )
  const loanByMatatu = useMemo(() => {
    const map = new Map<string, Loan>()
    activeLoans.forEach((loan) => {
      if (!loan.matatu_id) return
      if (!map.has(loan.matatu_id)) map.set(loan.matatu_id, loan)
    })
    return map
  }, [activeLoans])
  const loanMatatuIds = useMemo(() => new Set(activeLoans.map((l) => l.matatu_id).filter(Boolean)), [activeLoans])
  const loanMatatus = useMemo(
    () => matatus.filter((m) => m.id && loanMatatuIds.has(m.id)),
    [matatus, loanMatatuIds],
  )

  const dailyPaidRows = useMemo(
    () =>
      matatus
        .filter((m) => m.id && dailyPaidMap.has(m.id))
        .map((m) => ({ matatu: m, paid: dailyPaidMap.get(m.id || '') as PaidInfo })),
    [matatus, dailyPaidMap],
  )
  const dailyUnpaidRows = useMemo(
    () => matatus.filter((m) => m.id && !dailyPaidMap.has(m.id)),
    [matatus, dailyPaidMap],
  )
  const savingsPaidRows = useMemo(
    () =>
      savingsMatatus
        .filter((m) => m.id && savingsPaidMap.has(m.id))
        .map((m) => ({ matatu: m, paid: savingsPaidMap.get(m.id || '') as PaidInfo })),
    [savingsMatatus, savingsPaidMap],
  )
  const savingsUnpaidRows = useMemo(
    () => savingsMatatus.filter((m) => m.id && !savingsPaidMap.has(m.id)),
    [savingsMatatus, savingsPaidMap],
  )
  const loanPaidRows = useMemo(
    () =>
      loanMatatus
        .filter((m) => m.id && loanPaidMap.has(m.id))
        .map((m) => ({ matatu: m, paid: loanPaidMap.get(m.id || '') as PaidInfo })),
    [loanMatatus, loanPaidMap],
  )
  const loanUnpaidRows = useMemo(
    () => loanMatatus.filter((m) => m.id && !loanPaidMap.has(m.id)),
    [loanMatatus, loanPaidMap],
  )

  const vehicleCareGrant = useMemo(
    () =>
      accessGrants.find(
        (grant) => grant.scope_type === 'OPERATOR' && String(grant.scope_id || '') === String(saccoId || ''),
      ) || null,
    [accessGrants, saccoId],
  )
  const hasVehicleCareAccess = Boolean(vehicleCareGrant)
  const canManageVehicleCare = Boolean(vehicleCareGrant?.can_manage_vehicle_care)
  const canManageCompliance = Boolean(vehicleCareGrant?.can_manage_compliance)
  const canViewVehicleCareAnalytics = vehicleCareGrant?.can_view_analytics !== false

  async function recordManual(
    kind: 'SACCO_FEE' | 'SAVINGS' | 'LOAN_REPAY',
    amountRaw: string,
    note: string,
    setMsg: (msg: string) => void,
    reset: () => void,
  ) {
    if (!saccoId || !matatuId) {
      setMsg('Pick a SACCO and matatu first')
      return
    }
    const amt = Number(amountRaw || 0)
    if (!(amt > 0)) {
      setMsg('Enter amount')
      return
    }
    setMsg('Saving...')
    try {
      const created = await api<Tx>('/api/staff/cash', {
        method: 'POST',
        body: {
          sacco_id: saccoId,
          matatu_id: matatuId,
          kind,
          amount: amt,
          payer_name: note.trim() || `Manual ${kind.split('_').join(' ').toLowerCase()}`,
          payer_phone: '',
          notes: note.trim(),
        },
        token,
      })
      setTxs((prev) => [created, ...prev])
      reset()
      setMsg('Saved')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  function recordDailyFee() {
    void recordManual('SACCO_FEE', dailyAmount, dailyNote, setDailyMsg, () => {
      setDailyAmount('')
      setDailyNote('')
    })
  }

  function recordLoanPayment() {
    void recordManual('LOAN_REPAY', loanAmount, loanNote, setLoanMsg, () => {
      setLoanAmount('')
      setLoanNote('')
    })
  }

  function recordSavingsPayment() {
    void recordManual('SAVINGS', savingsAmount, savingsNote, setSavingsMsg, () => {
      setSavingsAmount('')
      setSavingsNote('')
    })
  }

  const heroRight = user?.role ? `Role: ${user.role}` : 'SACCO Staff'
  const operatorLabel = useMemo(() => {
    const match = saccos.find((s) => s.sacco_id === saccoId)
    return match?.name || 'Operator'
  }, [saccos, saccoId])
  const staffLabel = staffName || user?.name || (user?.email ? user.email.split('@')[0] : '') || 'Staff'

  const nav = (
    <>
      <NavLink className={({ isActive }) => `tab${isActive ? ' active' : ''}`} to="/sacco/staff">
        Cash Desk
      </NavLink>
    </>
  )

  return (
    <DashboardShell title="SACCO Staff" subtitle="Cash Desk" nav={nav} navLabel="SACCO staff navigation">
      <div className="hero-bar" style={{ marginBottom: 16 }}>
        <div className="hero-left">
          <div className="hero-chip">SACCO STAFF</div>
          <h2 style={{ margin: '6px 0 4px' }}>{operatorLabel} Dashboard</h2>
          <div className="muted">Hello, {staffLabel}</div>
          <div className="muted">Collect daily fees, loans, and savings</div>
          <div className="hero-inline">
            <span className="sys-pill-lite">{todayKey()}</span>
            <span className="sys-pill-lite">{timeLabel}</span>
            <span className="sys-pill-lite">Matatus: {matatus.length || 0}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <div className="badge-ghost">{heroRight}</div>
          <button type="button" className="btn ghost" onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            <div className="muted small">SACCO</div>
            <select value={saccoId} onChange={(e) => setSaccoId(e.target.value)} style={{ padding: 10, minWidth: 180 }}>
              {saccos.map((s) => (
                <option key={s.sacco_id} value={s.sacco_id || ''}>
                  {s.name || s.sacco_id}
                </option>
              ))}
            </select>
          </label>
          {loading ? <span className="muted small">Loading...</span> : null}
          {error ? <span className="err">{error}</span> : null}
        </div>
      </section>

      <nav className="sys-nav" aria-label="SACCO staff sections">
        {[
          { id: 'daily', label: 'Daily Fee' },
          { id: 'loans', label: 'Loans' },
          { id: 'savings', label: 'Savings' },
          { id: 'vehicle_care', label: 'Vehicle Care' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sys-tab${activeTab === (t.id as typeof activeTab) ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id as typeof activeTab)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === 'daily' ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Daily Fee - Unpaid Today</h3>
              <span className="muted small">{dailyUnpaidRows.length} matatu(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Matatu</th>
                    <th>Owner</th>
                    <th>Phone</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {matatus.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No matatus loaded.
                      </td>
                    </tr>
                  ) : dailyUnpaidRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        All matatus have paid today.
                      </td>
                    </tr>
                  ) : (
                    dailyUnpaidRows.map((m) => (
                      <tr key={m.id || m.number_plate}>
                        <td>{m.number_plate || m.id || ''}</td>
                        <td>{m.owner_name || ''}</td>
                        <td>{m.owner_phone || ''}</td>
                        <td>
                          <button type="button" className="btn ghost" onClick={() => setMatatuId(m.id || '')}>
                            Select
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Daily Fee - Paid Today</h3>
              <span className="muted small">{dailyPaidRows.length} matatu(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Matatu</th>
                    <th>Amount</th>
                    <th>Last paid</th>
                  </tr>
                </thead>
                <tbody>
                  {matatus.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No matatus loaded.
                      </td>
                    </tr>
                  ) : dailyPaidRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No daily fee payments yet.
                      </td>
                    </tr>
                  ) : (
                    dailyPaidRows.map(({ matatu, paid }) => (
                      <tr key={matatu.id || matatu.number_plate}>
                        <td>{matatu.number_plate || matatu.id || ''}</td>
                        <td>{fmtKES(paid.total)}</td>
                        <td>{paid.last_at ? new Date(paid.last_at).toLocaleTimeString() : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Manual collection</h3>
              <span className="muted small">{dailyMsg}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="muted small">
                Matatu
                <select value={matatuId} onChange={(e) => setMatatuId(e.target.value)} style={{ padding: 10, minWidth: 180 }}>
                  <option value="">Select matatu</option>
                  {matatus.map((m) => (
                    <option key={m.id} value={m.id || ''}>
                      {m.number_plate || m.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted small">
                Amount (KES)
                <input
                  type="number"
                  value={dailyAmount}
                  onChange={(e) => setDailyAmount(e.target.value)}
                  style={{ width: 180 }}
                />
              </label>
              <label className="muted small" style={{ flex: '1 1 240px' }}>
                Note (optional)
                <input value={dailyNote} onChange={(e) => setDailyNote(e.target.value)} />
              </label>
              <button type="button" className="btn" onClick={recordDailyFee}>
                Collect
              </button>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'loans' ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Loan Repayments - Unpaid Today</h3>
              <span className="muted small">{loanUnpaidRows.length} matatu(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Matatu</th>
                    <th>Borrower</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loanMatatus.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No active loans.
                      </td>
                    </tr>
                  ) : loanUnpaidRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        All loan matatus have paid today.
                      </td>
                    </tr>
                  ) : (
                    loanUnpaidRows.map((m) => (
                      <tr key={m.id || m.number_plate}>
                        <td>{m.number_plate || m.id || ''}</td>
                        <td>{loanByMatatu.get(m.id || '')?.borrower_name || m.owner_name || ''}</td>
                        <td>
                          <button type="button" className="btn ghost" onClick={() => setMatatuId(m.id || '')}>
                            Select
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Loan Repayments - Paid Today</h3>
              <span className="muted small">{loanPaidRows.length} matatu(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Matatu</th>
                    <th>Amount</th>
                    <th>Last paid</th>
                  </tr>
                </thead>
                <tbody>
                  {loanMatatus.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No active loans.
                      </td>
                    </tr>
                  ) : loanPaidRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No loan repayments yet.
                      </td>
                    </tr>
                  ) : (
                    loanPaidRows.map(({ matatu, paid }) => (
                      <tr key={matatu.id || matatu.number_plate}>
                        <td>{matatu.number_plate || matatu.id || ''}</td>
                        <td>{fmtKES(paid.total)}</td>
                        <td>{paid.last_at ? new Date(paid.last_at).toLocaleTimeString() : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Manual collection</h3>
              <span className="muted small">{loanMsg}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="muted small">
                Matatu
                <select value={matatuId} onChange={(e) => setMatatuId(e.target.value)} style={{ padding: 10, minWidth: 180 }}>
                  <option value="">Select matatu</option>
                  {loanMatatus.map((m) => (
                    <option key={m.id} value={m.id || ''}>
                      {m.number_plate || m.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted small">
                Amount (KES)
                <input type="number" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} style={{ width: 180 }} />
              </label>
              <label className="muted small" style={{ flex: '1 1 240px' }}>
                Note (optional)
                <input value={loanNote} onChange={(e) => setLoanNote(e.target.value)} />
              </label>
              <button type="button" className="btn" onClick={recordLoanPayment}>
                Collect
              </button>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'savings' ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Savings - Unpaid Today</h3>
              <span className="muted small">{savingsUnpaidRows.length} matatu(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Matatu</th>
                    <th>Owner</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {savingsMatatus.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No matatus enrolled in savings.
                      </td>
                    </tr>
                  ) : savingsUnpaidRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        All savings members have paid today.
                      </td>
                    </tr>
                  ) : (
                    savingsUnpaidRows.map((m) => (
                      <tr key={m.id || m.number_plate}>
                        <td>{m.number_plate || m.id || ''}</td>
                        <td>{m.owner_name || ''}</td>
                        <td>
                          <button type="button" className="btn ghost" onClick={() => setMatatuId(m.id || '')}>
                            Select
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Savings - Paid Today</h3>
              <span className="muted small">{savingsPaidRows.length} matatu(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Matatu</th>
                    <th>Amount</th>
                    <th>Last paid</th>
                  </tr>
                </thead>
                <tbody>
                  {savingsMatatus.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No matatus enrolled in savings.
                      </td>
                    </tr>
                  ) : savingsPaidRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No savings payments yet.
                      </td>
                    </tr>
                  ) : (
                    savingsPaidRows.map(({ matatu, paid }) => (
                      <tr key={matatu.id || matatu.number_plate}>
                        <td>{matatu.number_plate || matatu.id || ''}</td>
                        <td>{fmtKES(paid.total)}</td>
                        <td>{paid.last_at ? new Date(paid.last_at).toLocaleTimeString() : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Manual collection</h3>
              <span className="muted small">{savingsMsg}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="muted small">
                Matatu
                <select value={matatuId} onChange={(e) => setMatatuId(e.target.value)} style={{ padding: 10, minWidth: 180 }}>
                  <option value="">Select matatu</option>
                  {savingsMatatus.map((m) => (
                    <option key={m.id} value={m.id || ''}>
                      {m.number_plate || m.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted small">
                Amount (KES)
                <input
                  type="number"
                  value={savingsAmount}
                  onChange={(e) => setSavingsAmount(e.target.value)}
                  style={{ width: 180 }}
                />
              </label>
              <label className="muted small" style={{ flex: '1 1 240px' }}>
                Note (optional)
                <input value={savingsNote} onChange={(e) => setSavingsNote(e.target.value)} />
              </label>
              <button type="button" className="btn" onClick={recordSavingsPayment}>
                Collect
              </button>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'vehicle_care' ? (
        hasVehicleCareAccess && saccoId ? (
          <VehicleCarePage
            context={{
              scope_type: 'OPERATOR',
              scope_id: saccoId,
              can_manage_vehicle_care: canManageVehicleCare,
              can_manage_compliance: canManageCompliance,
              can_view_analytics: canViewVehicleCareAnalytics,
            }}
          />
        ) : (
          <section className="card">
            <div className="muted">Vehicle Care access is not enabled. Contact your SACCO admin.</div>
          </section>
        )
      ) : null}
    </DashboardShell>
  )
}

export default SaccoStaffDashboard
