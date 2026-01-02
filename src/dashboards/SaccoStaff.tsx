import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { api } from '../services/api'
import { useAuth } from '../state/auth'
import VehicleCarePage from '../modules/vehicleCare/VehicleCarePage'
import { fetchAccessGrants, type AccessGrant } from '../modules/vehicleCare/vehicleCare.api'

type Sacco = { sacco_id?: string; name?: string }
type Matatu = { id?: string; number_plate?: string; sacco_id?: string }
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
const manualKey = (matatuId: string) => `tt_sacco_staff_manual_${matatuId || 'na'}`

const SaccoStaffDashboard = () => {
  const { token, user, logout } = useAuth()

  const [saccos, setSaccos] = useState<Sacco[]>([])
  const [matatus, setMatatus] = useState<Matatu[]>([])
  const [saccoId, setSaccoId] = useState('')
  const [matatuId, setMatatuId] = useState('')

  const [txs, setTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [manualAmount, setManualAmount] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [manualMsg, setManualMsg] = useState('')
  const [manualEntries, setManualEntries] = useState<{ id: string; amount: number; note?: string; created_at: string }[]>([])
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
        const [mRes, tRes] = await Promise.all([
          fetchJson<{ items?: Matatu[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/matatus`),
          fetchJson<{ items?: Tx[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/transactions?limit=500`),
        ])
        const mats = mRes.items || []
        setMatatus(mats)
        if (mats.length) setMatatuId((prev) => prev || (mats[0].id || ''))
        setTxs((tRes.items || []).filter((t) => !matatuId || t.matatu_id === matatuId || !t.matatu_id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    void loadData()
  }, [fetchJson, saccoId, matatuId])

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

  const txByKind = useMemo(() => {
    const norm = (k?: string) => (k || '').toUpperCase()
    return {
      daily: txs.filter((t) => ['CASH', 'SACCO_FEE'].includes(norm(t.kind))),
      loans: txs.filter((t) => norm(t.kind) === 'LOAN_REPAY'),
      savings: txs.filter((t) => norm(t.kind) === 'SAVINGS'),
    }
  }, [txs])

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

  async function recordManualCash() {
    if (!saccoId || !matatuId) {
      setManualMsg('Pick a SACCO and matatu first')
      return
    }
    const amt = Number(manualAmount || 0)
    if (!(amt > 0)) {
      setManualMsg('Enter amount')
      return
    }
    setManualMsg('Saving...')
    try {
      await api('/api/staff/cash', {
        method: 'POST',
        body: {
          sacco_id: saccoId,
          matatu_id: matatuId,
          kind: 'CASH',
          amount: amt,
          payer_name: manualNote.trim() || 'Manual cash entry',
          payer_phone: '',
        },
        token,
      })
      const entry = { id: `MAN_${Date.now()}`, amount: amt, note: manualNote, created_at: new Date().toISOString() }
      const next = [entry, ...manualEntries]
      setManualEntries(next)
      localStorage.setItem(manualKey(matatuId), JSON.stringify(next))
      setManualAmount('')
      setManualNote('')
      setManualMsg('Saved')
    } catch (err) {
      setManualMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const heroRight = user?.role ? `Role: ${user.role}` : 'SACCO Staff'
  const operatorLabel = useMemo(() => {
    const match = saccos.find((s) => s.sacco_id === saccoId)
    return match?.name || 'Operator'
  }, [saccos, saccoId])
  const staffLabel = staffName || user?.name || (user?.email ? user.email.split('@')[0] : '') || 'Staff'

  return (
    <DashboardShell title="SACCO Staff" subtitle="Cash Desk" hideShellChrome>
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
          <label>
            <div className="muted small">Matatu</div>
            <select value={matatuId} onChange={(e) => setMatatuId(e.target.value)} style={{ padding: 10, minWidth: 180 }}>
              {matatus.map((m) => (
                <option key={m.id} value={m.id || ''}>
                  {m.number_plate || m.id}
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
              <h3 style={{ margin: 0 }}>Daily Fee</h3>
              <span className="muted small">{txByKind.daily.length} paid today</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Matatu</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {txByKind.daily.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No daily fee payments yet.
                      </td>
                    </tr>
                  ) : (
                    txByKind.daily.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{tx.matatu_id || matatuId}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ''}</td>
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
              <span className="muted small">{manualMsg}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                type="number"
                placeholder="Amount (KES)"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                style={{ width: 200 }}
              />
              <input
                placeholder="Payer / note"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                style={{ flex: '1 1 240px' }}
              />
              <button type="button" onClick={recordManualCash}>
                Collect
              </button>
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
                        <td>{e.note || ''}</td>
                        <td className="mono">{e.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {activeTab === 'loans' ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Loans (due today)</h3>
            <span className="muted small">{txByKind.loans.length} records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Matatu</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {txByKind.loans.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No loan repayments today.
                    </td>
                  </tr>
                ) : (
                  txByKind.loans.map((tx) => (
                    <tr key={tx.id || tx.created_at}>
                      <td>{tx.matatu_id || matatuId}</td>
                      <td>{fmtKES(tx.fare_amount_kes)}</td>
                      <td>{tx.status || ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === 'savings' ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Savings</h3>
            <span className="muted small">{txByKind.savings.length} records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Matatu</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {txByKind.savings.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No savings payments today.
                    </td>
                  </tr>
                ) : (
                  txByKind.savings.map((tx) => (
                    <tr key={tx.id || tx.created_at}>
                      <td>{tx.matatu_id || matatuId}</td>
                      <td>{fmtKES(tx.fare_amount_kes)}</td>
                      <td>{tx.status || ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
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
