import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { useAuth } from '../state/auth'
import { authFetch } from '../lib/auth'
import VehicleCarePage from '../modules/vehicleCare/VehicleCarePage'
import { fetchAccessGrants, saveAccessGrant, type AccessGrant } from '../modules/vehicleCare/vehicleCare.api'

type Vehicle = {
  id?: string
  number_plate?: string
  sacco_id?: string
  sacco_name?: string
}

type Tx = {
  id?: string
  created_at?: string
  kind?: string
  fare_amount_kes?: number
  phone?: string
  status?: string
  created_by_name?: string
  created_by_email?: string
  notes?: string
}

type Staff = {
  id?: string
  name?: string
  phone?: string
  email?: string
  role?: string
  user_id?: string
}

type LoanRequest = {
  id?: string
  amount_kes?: number
  model?: string
  term_months?: number
  status?: string
  note?: string
  created_at?: string
}

type LoanDue = {
  id?: string
  matatu_id?: string
  due_amount?: number
  owner?: string
  due_date?: string
}

type Loan = {
  id?: string
  matatu_id?: string
  borrower_name?: string
  principal_kes?: number
  interest_rate_pct?: number
  term_months?: number
  status?: string
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return (await res.json()) as T
}

const formatKes = (val?: number | null) => `KES ${(Number(val || 0)).toLocaleString('en-KE')}`

const MatatuOwnerDashboard = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [txs, setTxs] = useState<Tx[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [loanReqs, setLoanReqs] = useState<LoanRequest[]>([])
  const [loanDue, setLoanDue] = useState<LoanDue[]>([])
  const [loans, setLoans] = useState<Loan[]>([])
  const [loanHist, setLoanHist] = useState<{ loanId: string | null; items: Tx[]; total?: number; msg?: string }>(
    { loanId: null, items: [], total: 0, msg: 'Select a loan' },
  )
  const [status, setStatus] = useState<string>('Loading vehicles...')
  const [err, setErr] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<string[]>([])

  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([])
  const [grantTarget, setGrantTarget] = useState('')
  const [grantForm, setGrantForm] = useState({
    role: 'STAFF',
    can_manage_staff: false,
    can_manage_vehicles: false,
    can_manage_vehicle_care: false,
    can_manage_compliance: false,
    can_view_analytics: true,
    is_active: true,
  })
  const [grantMsg, setGrantMsg] = useState('')
  const [grantError, setGrantError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<
    'overview' | 'staff' | 'staff_logins' | 'tx' | 'loans' | 'savings' | 'vehicle_care'
  >('overview')
  const { user, logout } = useAuth()

  // staff form
  const [stName, setStName] = useState('')
  const [stPhone, setStPhone] = useState('')
  const [stEmail, setStEmail] = useState('')
  const [stRole, setStRole] = useState('MATATU_STAFF')
  const [stMsg, setStMsg] = useState('')

  // staff login form
  const [loginSourceId, setLoginSourceId] = useState('')
  const [loginName, setLoginName] = useState('')
  const [loginPhone, setLoginPhone] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginRole, setLoginRole] = useState('MATATU_STAFF')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginMsg, setLoginMsg] = useState('')

  // loan form
  const [loanAmount, setLoanAmount] = useState<number | ''>('')
  const [loanModel, setLoanModel] = useState('MONTHLY')
  const [loanTerm, setLoanTerm] = useState(3)
  const [loanNote, setLoanNote] = useState('')
  const [loanPayout, setLoanPayout] = useState<'CASH' | 'M_PESA' | 'ACCOUNT'>('CASH')
  const [loanPhone, setLoanPhone] = useState('')
  const [loanAccount, setLoanAccount] = useState('')
  const [loanMsg, setLoanMsg] = useState('')

  const currentVehicle = useMemo(
    () => vehicles.find((v) => v.id === currentId) || null,
    [vehicles, currentId],
  )
  const ownerScopeId = user?.matatu_id || currentId || null

  const staffLoginOptions = useMemo(() => {
    return staff
      .map((s) => {
        const key = s.id || s.user_id || s.email || s.phone || ''
        if (!key) return null
        const labelBase = s.name || s.email || s.phone || key
        const suffix = s.user_id ? ' (login exists)' : ''
        return { key, label: `${labelBase}${suffix}`, staff: s }
      })
      .filter((option): option is { key: string; label: string; staff: Staff } => Boolean(option))
  }, [staff])

  useEffect(() => {
    setLoanHist({ loanId: null, items: [], total: 0, msg: 'Select a loan' })
  }, [currentId])

  useEffect(() => {
    async function loadVehicles() {
      try {
        const data = await fetchJson<{ items?: Vehicle[] }>('/u/vehicles')
        const items = data.items || []
        setVehicles(items)
        setStatus(`${items.length} vehicle(s)`)
        if (items.length) setCurrentId(items[0].id || null)
      } catch (error) {
        setErr(error instanceof Error ? error.message : 'Failed to load vehicles')
        setStatus('Error')
      }
    }
    void loadVehicles()
  }, [])

  useEffect(() => {
    if (!currentId) return
    const id: string = currentId
    async function load() {
      setErr(null)
      setStatus('Loading data...')
      try {
        const [txRes, stRes] = await Promise.all([
          fetchJson<{ items?: Tx[] }>(`/u/matatu/${encodeURIComponent(id)}/transactions?limit=200`),
          fetchJson<{ items?: Staff[] }>(`/u/matatu/${encodeURIComponent(id)}/staff`),
        ])
        setTxs(txRes.items || [])
        setStaff(stRes.items || [])
        setStatus('Loaded')
      } catch (error) {
        setErr(error instanceof Error ? error.message : 'Failed to load data')
      }
    }
    void load()
  }, [currentId])

  useEffect(() => {
    if (!ownerScopeId) return
    void (async () => {
      try {
        const items = await fetchAccessGrants({ scope_type: 'OWNER', scope_id: ownerScopeId, all: true })
        setAccessGrants(items)
      } catch (err) {
        setGrantError(err instanceof Error ? err.message : 'Failed to load access grants')
        setAccessGrants([])
      }
    })()
  }, [ownerScopeId])

  useEffect(() => {
    if (!staff.length) {
      setGrantTarget('')
      return
    }
    if (!grantTarget) {
      const first = staff.find((s) => s.user_id) || staff[0]
      setGrantTarget(first?.user_id || '')
    }
  }, [staff, grantTarget])

  useEffect(() => {
    if (!grantTarget) {
      setGrantForm({
        role: 'STAFF',
        can_manage_staff: false,
        can_manage_vehicles: false,
        can_manage_vehicle_care: false,
        can_manage_compliance: false,
        can_view_analytics: true,
        is_active: true,
      })
      return
    }
    const grant = accessGrants.find((g) => g.user_id === grantTarget)
    setGrantForm({
      role: grant?.role || 'STAFF',
      can_manage_staff: !!grant?.can_manage_staff,
      can_manage_vehicles: !!grant?.can_manage_vehicles,
      can_manage_vehicle_care: !!grant?.can_manage_vehicle_care,
      can_manage_compliance: !!grant?.can_manage_compliance,
      can_view_analytics: grant?.can_view_analytics !== false,
      is_active: grant?.is_active !== false,
    })
  }, [accessGrants, grantTarget])

  useEffect(() => {
    const saccoId = currentVehicle?.sacco_id
    if (!saccoId) return
    const sid: string = saccoId
    async function loadLoans() {
      try {
        const [reqs, due, saccoLoans] = await Promise.all([
          fetchJson<{ items?: LoanRequest[] }>(`/u/sacco/${encodeURIComponent(sid)}/loan-requests`),
          fetchJson<{ items?: LoanDue[] }>(`/u/sacco/${encodeURIComponent(sid)}/loans/due-today`),
          fetchJson<{ items?: Loan[] }>(`/u/sacco/${encodeURIComponent(sid)}/loans`),
        ])
        const allLoans = (saccoLoans.items || []).filter((ln) => !currentId || ln.matatu_id === currentId)
        setLoanReqs(reqs.items || [])
        setLoanDue(due.items || [])
        setLoans(allLoans)
        const notes: string[] = []
        const pending = (reqs.items || []).filter((r) => (r.status || '').toUpperCase() === 'PENDING').length
        if (pending) notes.push(`${pending} loan request${pending > 1 ? 's' : ''} pending`)
        const dueCount = (due.items || []).length
        if (dueCount) notes.push(`${dueCount} loan${dueCount > 1 ? 's' : ''} due today/overdue`)
        setAlerts(notes)
      } catch (error) {
        setErr(error instanceof Error ? error.message : 'Failed to load loan data')
      }
    }
    void loadLoans()
  }, [currentVehicle])

  async function addStaff() {
    if (!currentId) return
    if (!stName.trim()) {
      setStMsg('Name required')
      return
    }
    setStMsg('Saving...')
    try {
      const body = {
        name: stName.trim(),
        phone: stPhone.trim() || null,
        email: stEmail.trim() || null,
        role: stRole,
      }
      await fetchJson(`/u/matatu/${encodeURIComponent(currentId)}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      setStMsg('Staff created/attached')
      setStName('')
      setStPhone('')
      setStEmail('')
      setStRole('MATATU_STAFF')
      const stRes = await fetchJson<{ items?: Staff[] }>(`/u/matatu/${encodeURIComponent(currentId)}/staff`)
      setStaff(stRes.items || [])
    } catch (error) {
      setStMsg(error instanceof Error ? error.message : 'Failed to save staff')
    }
  }

  async function createStaffLogin() {
    if (!currentId) return
    const name = loginName.trim()
    const email = loginEmail.trim()
    const phone = loginPhone.trim() || null
    const role = loginRole
    const password = loginPassword.trim()
    const selected = staffLoginOptions.find((opt) => opt.key === loginSourceId)?.staff || null

    if (!name) {
      setLoginMsg('Name required')
      return
    }
    if (!email) {
      setLoginMsg('Email required')
      return
    }
    if (!password || password.length < 6) {
      setLoginMsg('Password must be at least 6 characters')
      return
    }
    if (selected?.user_id) {
      setLoginMsg('Login already exists for this staff')
      return
    }

    setLoginMsg('Saving...')
    try {
      await fetchJson(`/u/matatu/${encodeURIComponent(currentId)}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email,
          role,
          password,
        }),
      })
      setLoginMsg('Login created')
      setLoginSourceId('')
      setLoginName('')
      setLoginPhone('')
      setLoginEmail('')
      setLoginRole('MATATU_STAFF')
      setLoginPassword('')
      const stRes = await fetchJson<{ items?: Staff[] }>(`/u/matatu/${encodeURIComponent(currentId)}/staff`)
      setStaff(stRes.items || [])
    } catch (error) {
      setLoginMsg(error instanceof Error ? error.message : 'Failed to create login')
    }
  }

  async function deleteStaff(id?: string) {
    if (!currentId || !id) return
    try {
      await fetchJson(`/u/matatu/${encodeURIComponent(currentId)}/staff/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      })
      const stRes = await fetchJson<{ items?: Staff[] }>(`/u/matatu/${encodeURIComponent(currentId)}/staff`)
      setStaff(stRes.items || [])
    } catch (error) {
      setStMsg(error instanceof Error ? error.message : 'Failed to delete staff')
    }
  }

  async function saveOwnerGrant() {
    if (!ownerScopeId) {
      setGrantMsg('Owner scope missing')
      return
    }
    if (!grantTarget) {
      setGrantMsg('Select a staff member')
      return
    }
    setGrantMsg('Saving access...')
    setGrantError(null)
    try {
      await saveAccessGrant({
        scope_type: 'OWNER',
        scope_id: ownerScopeId,
        user_id: grantTarget,
        role: grantForm.role,
        can_manage_staff: grantForm.can_manage_staff,
        can_manage_vehicles: grantForm.can_manage_vehicles,
        can_manage_vehicle_care: grantForm.can_manage_vehicle_care,
        can_manage_compliance: grantForm.can_manage_compliance,
        can_view_analytics: grantForm.can_view_analytics,
        is_active: grantForm.is_active,
      })
      setGrantMsg('Access updated')
      const items = await fetchAccessGrants({ scope_type: 'OWNER', scope_id: ownerScopeId, all: true })
      setAccessGrants(items)
    } catch (error) {
      setGrantMsg('')
      setGrantError(error instanceof Error ? error.message : 'Failed to save access')
    }
  }

  async function submitLoan() {
    if (!currentId) return
    if (!loanAmount || Number(loanAmount) <= 0) {
      setLoanMsg('Enter amount')
      return
    }
    setLoanMsg('Submitting...')
    try {
      const body = {
        amount_kes: Number(loanAmount),
        model: loanModel,
        term_months: Number(loanTerm),
        note: loanNote || null,
        payout_method: loanPayout,
        payout_phone: loanPhone || null,
        payout_account: loanAccount || null,
      }
      await fetchJson(`/u/matatu/${encodeURIComponent(currentId)}/loan-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      setLoanMsg('Loan request submitted')
      setLoanAmount('')
      setLoanNote('')
      setLoanPhone('')
      setLoanAccount('')
      const saccoId = currentVehicle?.sacco_id
      if (saccoId) {
        const reqs = await fetchJson<{ items?: LoanRequest[] }>(
          `/u/sacco/${encodeURIComponent(saccoId)}/loan-requests`,
        )
        setLoanReqs(reqs.items || [])
      }
    } catch (error) {
      setLoanMsg(error instanceof Error ? error.message : 'Loan request failed')
    }
  }

  async function loadLoanHistory(id?: string) {
    const saccoId = currentVehicle?.sacco_id
    if (!saccoId || !id) return
    setLoanHist({ loanId: id, items: [], total: 0, msg: 'Loading history...' })
    try {
      const res = await fetchJson<{ items?: Tx[]; total?: number }>(
        `/u/sacco/${encodeURIComponent(saccoId)}/loans/${encodeURIComponent(id)}/payments`,
      )
      setLoanHist({ loanId: id, items: res.items || [], total: res.total || 0, msg: '' })
    } catch (error) {
      setLoanHist({ loanId: id, items: [], total: 0, msg: error instanceof Error ? error.message : 'Load failed' })
    }
  }

  const todaySummary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const filtered = txs.filter((tx) => (tx.created_at || '').slice(0, 10) === today)
    const kindSum = (k: string) =>
      filtered
        .filter((tx) => (tx.kind || '').toUpperCase() === k)
        .reduce((sum, tx) => sum + Number(tx.fare_amount_kes || 0), 0)
    return {
      fees: kindSum('SACCO_FEE'),
      savings: kindSum('SAVINGS'),
      loanRepay: kindSum('LOAN_REPAY'),
    }
  }, [txs])

  const savingsTxs = useMemo(
    () => txs.filter((tx) => (tx.kind || '').toUpperCase() === 'SAVINGS'),
    [txs],
  )
  const savingsTotal = useMemo(
    () => savingsTxs.reduce((sum, tx) => sum + Number(tx.fare_amount_kes || 0), 0),
    [savingsTxs],
  )

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'staff' as const, label: 'Staff' },
    { id: 'staff_logins' as const, label: 'Staff Logins' },
    { id: 'tx' as const, label: 'Transactions' },
    { id: 'loans' as const, label: 'Loans' },
    { id: 'savings' as const, label: 'Savings' },
    { id: 'vehicle_care' as const, label: 'Vehicle Care' },
  ]

  return (
    <DashboardShell title="Matatu Owner" subtitle="Owner dashboard" hideShellChrome>
      <div className="hero-bar" style={{ marginBottom: 16 }}>
        <div className="hero-left">
          <div className="hero-chip">Matatu Owner Console</div>
          <h2 style={{ margin: '6px 0 4px' }}>Hello, {currentVehicle?.number_plate || 'owner'}</h2>
          <div className="muted">Manage your matatu, staff, loans, and savings</div>
          <div className="hero-inline">
            <span className="sys-pill-lite">
              Operate Under: {currentVehicle?.sacco_name || '-'}
            </span>
            <span className="sys-pill-lite">{status}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <div className="badge-ghost">{currentVehicle?.number_plate || 'Select a vehicle'}</div>
          <button type="button" className="btn ghost" onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            <div className="muted small">My Matatu</div>
            <select
              value={currentId ?? ''}
              onChange={(e) => setCurrentId(e.target.value || null)}
              style={{ padding: 10, minWidth: 220 }}
            >
              {vehicles.map((v) => (
                <option key={v.id || v.number_plate} value={v.id || ''}>
                  {v.number_plate || v.id || 'Vehicle'}
                </option>
              ))}
            </select>
          </label>
          {err ? <div className="err">{err}</div> : null}
        </div>
      </section>

      <nav className="sys-nav" aria-label="Matatu owner sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sys-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' ? (
        <>
          {alerts.length ? (
            <section className="card" style={{ background: '#f8fafc' }}>
              <div className="topline">
                <h3 style={{ margin: 0 }}>Notifications</h3>
                <span className="muted small">{currentVehicle?.number_plate || ''}</span>
              </div>
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                {alerts.map((a, idx) => (
                  <li key={idx} style={{ margin: '4px 0' }}>
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Matatu snapshot</h3>
            <div className="grid g2" style={{ gap: 12 }}>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="muted small">Plate</div>
                <div style={{ fontWeight: 700 }}>{currentVehicle?.number_plate || '-'}</div>
              </div>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="muted small">Operate Under</div>
                <div>{currentVehicle?.sacco_name || '-'}</div>
              </div>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="muted small">Fees Today</div>
                <div style={{ fontWeight: 700 }}>{formatKes(todaySummary.fees)}</div>
              </div>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="muted small">Savings Today</div>
                <div style={{ fontWeight: 700 }}>{formatKes(todaySummary.savings)}</div>
              </div>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="muted small">Loan Repay Today</div>
                <div style={{ fontWeight: 700 }}>{formatKes(todaySummary.loanRepay)}</div>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'staff' ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Staff</h3>
            <span className="muted small">{staff.length} staff</span>
          </div>
          <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Full name" value={stName} onChange={(e) => setStName(e.target.value)} />
            <input className="input" placeholder="Phone" value={stPhone} onChange={(e) => setStPhone(e.target.value)} />
            <input className="input" placeholder="Email" value={stEmail} onChange={(e) => setStEmail(e.target.value)} />
            <select value={stRole} onChange={(e) => setStRole(e.target.value)} style={{ padding: 10 }}>
              <option value="MATATU_STAFF">MATATU_STAFF</option>
              <option value="DRIVER">DRIVER</option>
            </select>
            <button className="btn ok" type="button" onClick={addStaff}>
              Create / Attach Staff
            </button>
          </div>
          <div className="muted small">{stMsg}</div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>User / ID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No staff loaded.
                    </td>
                  </tr>
                ) : (
                  staff.map((s) => (
                    <tr key={s.id || s.email || s.user_id}>
                      <td>{s.name || ''}</td>
                      <td>{s.phone || ''}</td>
                      <td>{s.email || ''}</td>
                      <td>{s.role || ''}</td>
                      <td className="mono">{s.user_id || s.id || ''}</td>
                      <td>
                        <button className="btn ghost" type="button" onClick={() => deleteStaff(s.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
            <div className="topline">
              <h4 style={{ margin: 0 }}>Vehicle Care access</h4>
              <span className="muted small">Grant staff permissions for Vehicle Care</span>
            </div>
            {grantError ? <div className="err">Access error: {grantError}</div> : null}
            {!staff.length ? (
              <div className="muted small">Create a staff member to grant access.</div>
            ) : (
              <>
                <div className="grid g2" style={{ marginTop: 8 }}>
                  <label className="muted small">
                    Staff member
                    <select
                      value={grantTarget}
                      onChange={(e) => setGrantTarget(e.target.value)}
                      style={{ padding: 10, minWidth: 200 }}
                    >
                      <option value="">Select staff</option>
                      {staff.map((s) => (
                        <option key={s.user_id || s.id} value={s.user_id || ''}>
                          {s.name || s.email || s.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="muted small">
                    Access role
                    <select
                      value={grantForm.role}
                      onChange={(e) => setGrantForm((f) => ({ ...f, role: e.target.value }))}
                      style={{ padding: 10 }}
                    >
                      <option value="STAFF">STAFF</option>
                      <option value="MANAGER">MANAGER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </label>
                  <label className="muted small">
                    <input
                      type="checkbox"
                      checked={grantForm.is_active}
                      onChange={(e) => setGrantForm((f) => ({ ...f, is_active: e.target.checked }))}
                      style={{ marginRight: 6 }}
                    />
                    Access active
                  </label>
                  <label className="muted small">
                    <input
                      type="checkbox"
                      checked={grantForm.can_manage_vehicle_care}
                      onChange={(e) => setGrantForm((f) => ({ ...f, can_manage_vehicle_care: e.target.checked }))}
                      style={{ marginRight: 6 }}
                    />
                    Manage Vehicle Care
                  </label>
                  <label className="muted small">
                    <input
                      type="checkbox"
                      checked={grantForm.can_manage_compliance}
                      onChange={(e) => setGrantForm((f) => ({ ...f, can_manage_compliance: e.target.checked }))}
                      style={{ marginRight: 6 }}
                    />
                    Manage compliance dates
                  </label>
                  <label className="muted small">
                    <input
                      type="checkbox"
                      checked={grantForm.can_manage_vehicles}
                      onChange={(e) => setGrantForm((f) => ({ ...f, can_manage_vehicles: e.target.checked }))}
                      style={{ marginRight: 6 }}
                    />
                    Manage vehicles
                  </label>
                  <label className="muted small">
                    <input
                      type="checkbox"
                      checked={grantForm.can_manage_staff}
                      onChange={(e) => setGrantForm((f) => ({ ...f, can_manage_staff: e.target.checked }))}
                      style={{ marginRight: 6 }}
                    />
                    Manage staff access
                  </label>
                  <label className="muted small">
                    <input
                      type="checkbox"
                      checked={grantForm.can_view_analytics}
                      onChange={(e) => setGrantForm((f) => ({ ...f, can_view_analytics: e.target.checked }))}
                      style={{ marginRight: 6 }}
                    />
                    View analytics
                  </label>
                </div>
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <button className="btn" type="button" onClick={saveOwnerGrant}>
                    Save access
                  </button>
                  <span className="muted small">{grantMsg}</span>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'staff_logins' ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Staff Logins</h3>
            <span className="muted small">Create login credentials for staff</span>
          </div>
          <div className="grid g2" style={{ marginTop: 8 }}>
            <label className="muted small">
              Copy from staff (optional)
              <select
                value={loginSourceId}
                onChange={(e) => {
                  const nextKey = e.target.value
                  setLoginSourceId(nextKey)
                  const match = staffLoginOptions.find((opt) => opt.key === nextKey)?.staff || null
                  if (!match) return
                  setLoginName(match.name || '')
                  setLoginEmail(match.email || '')
                  setLoginPhone(match.phone || '')
                  setLoginRole(match.role || 'MATATU_STAFF')
                }}
                style={{ padding: 10 }}
              >
                <option value="">Select staff</option>
                {staffLoginOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted small">
              Full name *
              <input
                className="input"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="Staff name"
              />
            </label>
            <label className="muted small">
              Email *
              <input
                className="input"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="staff@email.com"
              />
            </label>
            <label className="muted small">
              Phone
              <input
                className="input"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
                placeholder="07xx..."
              />
            </label>
            <label className="muted small">
              Role
              <select value={loginRole} onChange={(e) => setLoginRole(e.target.value)} style={{ padding: 10 }}>
                <option value="MATATU_STAFF">MATATU_STAFF</option>
                <option value="DRIVER">DRIVER</option>
              </select>
            </label>
            <label className="muted small">
              Password *
              <input
                className="input"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ok" type="button" onClick={createStaffLogin}>
              Create login
            </button>
            <span className="muted small">{loginMsg}</span>
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>
            This will create a staff profile and user login for the selected matatu.
          </div>
        </section>
      ) : null}

      {activeTab === 'tx' ? (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Transactions (recent)</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Kind</th>
                  <th>Amount</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>ID</th>
                </tr>
              </thead>
              <tbody>
                {txs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No transactions.
                    </td>
                  </tr>
                ) : (
                  txs.map((tx) => (
                    <tr key={tx.id || tx.created_at}>
                      <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                      <td>{tx.kind || ''}</td>
                      <td>{formatKes(tx.fare_amount_kes)}</td>
                      <td>{tx.phone || ''}</td>
                      <td>{tx.status || ''}</td>
                      <td className="mono">{tx.id || ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === 'loans' ? (
        <>
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Loan requests</h3>
            <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <input
                className="input"
                type="number"
                placeholder="Amount"
                value={loanAmount}
                onChange={(e) => setLoanAmount(e.target.value ? Number(e.target.value) : '')}
                style={{ maxWidth: 160 }}
              />
              <select value={loanModel} onChange={(e) => setLoanModel(e.target.value)} style={{ padding: 10 }}>
                <option value="DAILY">DAILY</option>
                <option value="WEEKLY">WEEKLY</option>
                <option value="MONTHLY">MONTHLY</option>
              </select>
              <select
                value={loanTerm}
                onChange={(e) => setLoanTerm(Number(e.target.value))}
                style={{ padding: 10, maxWidth: 120 }}
              >
                {[1, 2, 3, 4, 5, 6].map((m) => (
                  <option key={m} value={m}>
                    {m} month{m === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
              <input
                className="input"
                placeholder="Note"
                value={loanNote}
                onChange={(e) => setLoanNote(e.target.value)}
                style={{ flex: 1, minWidth: 200 }}
              />
            </div>
            <div className="row" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <label className="muted small">Payout</label>
              <select
                value={loanPayout}
                onChange={(e) => setLoanPayout(e.target.value as 'CASH' | 'M_PESA' | 'ACCOUNT')}
                style={{ padding: 10 }}
              >
                <option value="CASH">Cash</option>
                <option value="M_PESA">M-PESA</option>
                <option value="ACCOUNT">Bank / Till account</option>
              </select>
              <input
                className="input"
                placeholder="Phone for M-PESA"
                value={loanPhone}
                onChange={(e) => setLoanPhone(e.target.value)}
                style={{ maxWidth: 180 }}
              />
              <input
                className="input"
                placeholder="Account / till"
                value={loanAccount}
                onChange={(e) => setLoanAccount(e.target.value)}
                style={{ maxWidth: 200 }}
              />
              <button className="btn ok" type="button" onClick={submitLoan}>
                Submit Request
              </button>
            </div>
            <div className="muted small">{loanMsg}</div>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Model</th>
                    <th>Term</th>
                    <th>Status</th>
                    <th>Note</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {loanReqs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        No requests loaded.
                      </td>
                    </tr>
                  ) : (
                    loanReqs.map((lr) => (
                      <tr key={lr.id}>
                        <td>{lr.created_at ? new Date(lr.created_at).toLocaleString() : ''}</td>
                        <td>{formatKes(lr.amount_kes)}</td>
                        <td>{lr.model || ''}</td>
                        <td>{lr.term_months || ''}</td>
                        <td>{lr.status || ''}</td>
                        <td>{lr.note || ''}</td>
                        <td className="mono">{lr.id || ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Due loans (today)</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Matatu</th>
                    <th>Owner</th>
                    <th>Due amount</th>
                    <th>Due date</th>
                  </tr>
                </thead>
                <tbody>
                  {loanDue.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No due loans today.
                      </td>
                    </tr>
                  ) : (
                    loanDue.map((r, idx) => (
                      <tr key={r.id || idx}>
                        <td>{r.matatu_id || ''}</td>
                        <td>{r.owner || ''}</td>
                        <td>{formatKes(r.due_amount)}</td>
                        <td>{r.due_date ? new Date(r.due_date).toLocaleDateString() : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ marginTop: 0 }}>Loans</h3>
              <span className="muted small">{loans.length} loan(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th>Matatu</th>
                    <th>Principal</th>
                    <th>Rate %</th>
                    <th>Term</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        No loans loaded.
                      </td>
                    </tr>
                  ) : (
                    loans.map((ln) => (
                      <tr key={ln.id}>
                        <td>{ln.borrower_name || ''}</td>
                        <td className="mono">{ln.matatu_id || ''}</td>
                        <td>{formatKes(ln.principal_kes)}</td>
                        <td>{ln.interest_rate_pct ?? ''}</td>
                        <td>{ln.term_months ?? ''}</td>
                        <td>{ln.status || ''}</td>
                        <td>
                          <button type="button" className="btn ghost" onClick={() => loadLoanHistory(ln.id)}>
                            History
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
              <h3 style={{ marginTop: 0 }}>Loan history</h3>
              <span className="muted small">{loanHist.msg || ''}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Amount</th>
                    <th>Staff</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {loanHist.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        {loanHist.msg || 'Select a loan to view history'}
                      </td>
                    </tr>
                  ) : (
                    loanHist.items.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{formatKes(tx.fare_amount_kes)}</td>
                        <td>{tx.created_by_name || tx.created_by_email || tx.phone || ''}</td>
                        <td>{tx.notes || ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {loanHist.items.length ? (
              <div className="muted small" style={{ marginTop: 6 }}>
                Total scheduled: {formatKes(loanHist.total)}
              </div>
            ) : null}
          </section>

        </>
      ) : null}

      {activeTab === 'savings' ? (
        <>
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Savings summary</h3>
            <div className="grid g3" style={{ gap: 12 }}>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="muted small">Today</div>
                <div style={{ fontWeight: 700 }}>{formatKes(todaySummary.savings)}</div>
              </div>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="muted small">Loaded total</div>
                <div style={{ fontWeight: 700 }}>{formatKes(savingsTotal)}</div>
              </div>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="muted small">Transactions</div>
                <div style={{ fontWeight: 700 }}>{savingsTxs.length}</div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ marginTop: 0 }}>Savings transactions</h3>
              <span className="muted small">{savingsTxs.length} record(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Amount</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Staff</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {savingsTxs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        No savings transactions.
                      </td>
                    </tr>
                  ) : (
                    savingsTxs.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{formatKes(tx.fare_amount_kes)}</td>
                        <td>{tx.phone || ''}</td>
                        <td>{tx.status || ''}</td>
                        <td>{tx.created_by_name || tx.created_by_email || ''}</td>
                        <td>{tx.notes || ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'vehicle_care' ? (
        ownerScopeId ? (
          <VehicleCarePage
            context={{
              scope_type: 'OWNER',
              scope_id: ownerScopeId,
              can_manage_vehicle_care: true,
              can_manage_compliance: true,
              can_view_analytics: true,
            }}
          />
        ) : (
          <section className="card">
            <div className="muted">Select a vehicle to view Vehicle Care.</div>
          </section>
        )
      ) : null}
    </DashboardShell>
  )
}

export default MatatuOwnerDashboard
