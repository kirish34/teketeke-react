import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { authFetch } from '../lib/auth'

type Overview = {
  counts?: {
    saccos?: number
    matatus?: number
    cashiers?: number
    tx_today?: number
  }
  ussd_pool?: { available?: number; total?: number }
}

type Sacco = {
  id?: string
  name?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  default_till?: string
}

type Matatu = {
  id?: string
  number_plate?: string
  vehicle_type?: string
  sacco_id?: string
  owner_name?: string
  owner_phone?: string
  till_number?: string
}

type UssdAvail = { full_code?: string }
type UssdAlloc = {
  full_code?: string
  status?: string
  allocated_to_type?: string
  allocated_to_id?: string
  allocated_at?: string
}

type LoginRow = {
  email?: string
  role?: string
  sacco_id?: string | null
  matatu_id?: string | null
  assigned_at?: string
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return (await res.json()) as T
}

const formatNum = (val?: number | null) => new Intl.NumberFormat('en-KE').format(val || 0)

const OpsDashboard = () => {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [saccos, setSaccos] = useState<Sacco[]>([])
  const [matatus, setMatatus] = useState<Matatu[]>([])
  const [ussdAvail, setUssdAvail] = useState<UssdAvail[]>([])
  const [ussdAlloc, setUssdAlloc] = useState<UssdAlloc[]>([])
  const [logins, setLogins] = useState<LoginRow[]>([])

  const [saccoForm, setSaccoForm] = useState({
    name: '',
    default_till: '',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    login_email: '',
    login_password: '',
  })
  const [saccoMsg, setSaccoMsg] = useState('')
  const [saccoFilter, setSaccoFilter] = useState('')

  const [matatuForm, setMatatuForm] = useState({
    sacco_id: '',
    number_plate: '',
    vehicle_type: 'MATATU',
    owner_name: '',
    owner_phone: '',
    tlb_number: '',
    till_number: '',
  })
  const [matatuMsg, setMatatuMsg] = useState('')
  const [matatuFilter, setMatatuFilter] = useState('')

  const [ussdForm, setUssdForm] = useState({
    prefix: '*001*',
    level: 'MATATU',
    matatu_id: '',
    sacco_id: '',
  })
  const [ussdMsg, setUssdMsg] = useState('')

  const filteredSaccos = useMemo(() => {
    if (!saccoFilter.trim()) return saccos
    const q = saccoFilter.toLowerCase()
    return saccos.filter((s) => (s.name || '').toLowerCase().includes(q))
  }, [saccos, saccoFilter])

  const filteredMatatus = useMemo(() => {
    if (!matatuFilter) return matatus
    return matatus.filter((m) => String(m.sacco_id || '') === matatuFilter)
  }, [matatus, matatuFilter])

  useEffect(() => {
    async function loadAll() {
      try {
        const [ov, sacs, mts, avail, alloc, logs] = await Promise.all([
          fetchJson<Overview>('/api/admin/system-overview'),
          fetchJson<{ items?: Sacco[] }>('/api/admin/saccos'),
          fetchJson<{ items?: Matatu[] }>('/api/admin/matatus'),
          fetchJson<{ items?: UssdAvail[] }>('/api/admin/ussd/pool/available'),
          fetchJson<{ items?: UssdAlloc[] }>('/api/admin/ussd/pool/allocated'),
          fetchJson<LoginRow[]>('/api/admin/user-roles/logins'),
        ])
        setOverview(ov)
        setSaccos(sacs.items || [])
        setMatatus(mts.items || [])
        setUssdAvail(avail.items || [])
        setUssdAlloc(alloc.items || [])
        setLogins(logs || [])
      } catch (err) {
        console.error('ops load failed', err)
      }
    }
    void loadAll()
  }, [])

  async function createSacco() {
    setSaccoMsg('Saving...')
    try {
      await authFetch('/api/admin/register-sacco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saccoForm),
      })
      setSaccoMsg('SACCO created')
      setSaccoForm({
        name: '',
        default_till: '',
        contact_name: '',
        contact_phone: '',
        contact_email: '',
        login_email: '',
        login_password: '',
      })
      const res = await fetchJson<{ items?: Sacco[] }>('/api/admin/saccos')
      setSaccos(res.items || [])
    } catch (err) {
      setSaccoMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function createMatatu() {
    setMatatuMsg('Saving...')
    try {
      await authFetch('/api/admin/register-matatu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(matatuForm),
      })
      setMatatuMsg('Vehicle registered')
      setMatatuForm({
        sacco_id: '',
        number_plate: '',
        vehicle_type: 'MATATU',
        owner_name: '',
        owner_phone: '',
        tlb_number: '',
        till_number: '',
      })
      const res = await fetchJson<{ items?: Matatu[] }>('/api/admin/matatus')
      setMatatus(res.items || [])
    } catch (err) {
      setMatatuMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function assignUssd() {
    setUssdMsg('Assigning...')
    try {
      const res = await authFetch('/api/admin/ussd/pool/assign-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ussdForm),
      })
      const data = await res.json().catch(() => ({}))
      setUssdMsg(`Assigned ${data?.ussd_code || 'code'}`)
      const [avail, alloc] = await Promise.all([
        fetchJson<{ items?: UssdAvail[] }>('/api/admin/ussd/pool/available'),
        fetchJson<{ items?: UssdAlloc[] }>('/api/admin/ussd/pool/allocated'),
      ])
      setUssdAvail(avail.items || [])
      setUssdAlloc(alloc.items || [])
    } catch (err) {
      setUssdMsg(err instanceof Error ? err.message : 'Assign failed')
    }
  }

  return (
    <DashboardShell title="Ops Dashboard" subtitle="SACCO, vehicle, USSD, logins">
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Overview</h3>
        <div className="grid metrics">
          <div className="metric">
            <div className="k">SACCOs</div>
            <div className="v">{formatNum(overview?.counts?.saccos)}</div>
          </div>
          <div className="metric">
            <div className="k">Matatus</div>
            <div className="v">{formatNum(overview?.counts?.matatus)}</div>
          </div>
          <div className="metric">
            <div className="k">Cashiers</div>
            <div className="v">{formatNum(overview?.counts?.cashiers)}</div>
          </div>
          <div className="metric">
            <div className="k">Tx today</div>
            <div className="v">{formatNum(overview?.counts?.tx_today)}</div>
          </div>
          <div className="metric">
            <div className="k">USSD available</div>
            <div className="v">{formatNum(overview?.ussd_pool?.available)}</div>
          </div>
          <div className="metric">
            <div className="k">USSD total</div>
            <div className="v">{formatNum(overview?.ussd_pool?.total)}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Register SACCO</h3>
        <div className="grid g2">
          <label className="muted small">
            Name
            <input
              className="input"
              value={saccoForm.name}
              onChange={(e) => setSaccoForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Default till
            <input
              className="input"
              value={saccoForm.default_till}
              onChange={(e) => setSaccoForm((f) => ({ ...f, default_till: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Contact name
            <input
              className="input"
              value={saccoForm.contact_name}
              onChange={(e) => setSaccoForm((f) => ({ ...f, contact_name: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Contact phone
            <input
              className="input"
              value={saccoForm.contact_phone}
              onChange={(e) => setSaccoForm((f) => ({ ...f, contact_phone: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Contact email
            <input
              className="input"
              value={saccoForm.contact_email}
              onChange={(e) => setSaccoForm((f) => ({ ...f, contact_email: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Admin login (optional)
            <input
              className="input"
              value={saccoForm.login_email}
              onChange={(e) => setSaccoForm((f) => ({ ...f, login_email: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Admin password
            <input
              className="input"
              type="password"
              value={saccoForm.login_password}
              onChange={(e) => setSaccoForm((f) => ({ ...f, login_password: e.target.value }))}
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" type="button" onClick={createSacco}>
            Create SACCO
          </button>
          <span className="muted small">{saccoMsg}</span>
          <input
            className="input"
            placeholder="Search by name"
            value={saccoFilter}
            onChange={(e) => setSaccoFilter(e.target.value)}
            style={{ maxWidth: 220 }}
          />
        </div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Till</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredSaccos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No SACCOs yet.
                  </td>
                </tr>
              ) : (
                filteredSaccos.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name || ''}</td>
                    <td>{row.contact_name || ''}</td>
                    <td>{row.contact_phone || ''}</td>
                    <td>{row.contact_email || ''}</td>
                    <td>{row.default_till || ''}</td>
                    <td className="mono">{row.id || ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Register vehicle</h3>
        <div className="grid g2">
          <label className="muted small">
            SACCO
            <select
              value={matatuForm.sacco_id}
              onChange={(e) => setMatatuForm((f) => ({ ...f, sacco_id: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="">-- optional for taxi/boda --</option>
              {saccos.map((s) => (
                <option key={s.id} value={s.id || ''}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </label>
          <label className="muted small">
            Plate
            <input
              className="input"
              value={matatuForm.number_plate}
              onChange={(e) => setMatatuForm((f) => ({ ...f, number_plate: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Vehicle type
            <select
              value={matatuForm.vehicle_type}
              onChange={(e) => setMatatuForm((f) => ({ ...f, vehicle_type: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="MATATU">Matatu</option>
              <option value="TAXI">Taxi</option>
              <option value="BODABODA">BodaBoda</option>
            </select>
          </label>
          <label className="muted small">
            Owner name
            <input
              className="input"
              value={matatuForm.owner_name}
              onChange={(e) => setMatatuForm((f) => ({ ...f, owner_name: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Owner phone
            <input
              className="input"
              value={matatuForm.owner_phone}
              onChange={(e) => setMatatuForm((f) => ({ ...f, owner_phone: e.target.value }))}
            />
          </label>
          <label className="muted small">
            TLB number
            <input
              className="input"
              value={matatuForm.tlb_number}
              onChange={(e) => setMatatuForm((f) => ({ ...f, tlb_number: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Till number
            <input
              className="input"
              value={matatuForm.till_number}
              onChange={(e) => setMatatuForm((f) => ({ ...f, till_number: e.target.value }))}
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" type="button" onClick={createMatatu}>
            Create vehicle
          </button>
          <span className="muted small">{matatuMsg}</span>
          <select
            value={matatuFilter}
            onChange={(e) => setMatatuFilter(e.target.value)}
            style={{ padding: 10, maxWidth: 200 }}
          >
            <option value="">All SACCOS</option>
            {saccos.map((s) => (
              <option key={s.id} value={s.id || ''}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Plate</th>
                <th>Type</th>
                <th>SACCO</th>
                <th>Owner</th>
                <th>Phone</th>
                <th>Till</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatatus.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No vehicles found.
                  </td>
                </tr>
              ) : (
                filteredMatatus.map((row) => (
                  <tr key={row.id || row.number_plate}>
                    <td>{row.number_plate || ''}</td>
                    <td>{row.vehicle_type || ''}</td>
                    <td>{row.sacco_id || ''}</td>
                    <td>{row.owner_name || ''}</td>
                    <td>{row.owner_phone || ''}</td>
                    <td>{row.till_number || ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>USSD pool</h3>
        <div className="grid g2">
          <label className="muted small">
            Prefix
            <input
              className="input"
              value={ussdForm.prefix}
              onChange={(e) => setUssdForm((f) => ({ ...f, prefix: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Level
            <select
              value={ussdForm.level}
              onChange={(e) => setUssdForm((f) => ({ ...f, level: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="MATATU">Matatu</option>
              <option value="SACCO">SACCO</option>
            </select>
          </label>
          <label className="muted small">
            Matatu ID
            <input
              className="input"
              value={ussdForm.matatu_id}
              onChange={(e) => setUssdForm((f) => ({ ...f, matatu_id: e.target.value }))}
            />
          </label>
          <label className="muted small">
            SACCO ID
            <input
              className="input"
              value={ussdForm.sacco_id}
              onChange={(e) => setUssdForm((f) => ({ ...f, sacco_id: e.target.value }))}
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" type="button" onClick={assignUssd}>
            Assign code
          </button>
          <span className="muted small">{ussdMsg}</span>
        </div>
        <div className="grid g2" style={{ marginTop: 12 }}>
          <div>
            <h4>Available codes</h4>
            <ul>
              {ussdAvail.length === 0 ? (
                <li className="muted">No free codes.</li>
              ) : (
                ussdAvail.slice(0, 30).map((c, idx) => <li key={c.full_code || idx}>{c.full_code}</li>)
              )}
            </ul>
          </div>
          <div className="table-wrap">
            <h4>Recent allocations</h4>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Level</th>
                  <th>Linked ID</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {ussdAlloc.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No allocations yet.
                    </td>
                  </tr>
                ) : (
                  ussdAlloc.slice(0, 30).map((r, idx) => (
                    <tr key={r.full_code || idx}>
                      <td>{r.full_code || ''}</td>
                      <td>{r.status || ''}</td>
                      <td>{r.allocated_to_type || ''}</td>
                      <td>{r.allocated_to_id || ''}</td>
                      <td>{r.allocated_at ? new Date(r.allocated_at).toLocaleString() : ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Recent role logins</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>SACCO</th>
                <th>Matatu</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {logins.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No logins.
                  </td>
                </tr>
              ) : (
                logins.map((l, idx) => (
                  <tr key={l.email || idx}>
                    <td>{l.email || ''}</td>
                    <td>{l.role || ''}</td>
                    <td>{l.sacco_id || ''}</td>
                    <td>{l.matatu_id || ''}</td>
                    <td>{l.assigned_at ? new Date(l.assigned_at).toLocaleString() : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardShell>
  )
}

export default OpsDashboard
