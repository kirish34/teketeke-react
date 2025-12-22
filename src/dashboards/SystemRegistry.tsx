import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { useAuth } from '../state/auth'
import { api } from '../services/api'
import { logEvent } from '../services/events'

type Device = {
  id: string
  label: string
  device_type: string
  vendor...: string
  model...: string
  serial...: string
  imei...: string
  sim_msisdn...: string
  sim_iccid...: string
  status...: string
  last_seen_at...: string | null
  created_at...: string
}

type Assignment = {
  id: string
  device_id: string
  sacco_id: string
  matatu_id: string
  route_id...: string | null
  assigned_at...: string
  active...: boolean
}

export default function SystemRegistry() {
  const { user, token } = useAuth()
  const [devices, setDevices] = useState<Device[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [form, setForm] = useState({
    label: '',
    device_type: 'router',
    vendor: '',
    model: '',
    serial: '',
    imei: '',
    sim_msisdn: '',
    sim_iccid: '',
    notes: '',
  })

  const [assignForm, setAssignForm] = useState({
    device_id: '',
    sacco_id: '',
    matatu_id: '',
    route_id: '',
  })

  async function loadAll() {
    setLoading(true)
    setErr('')
    try {
      const d = await api('/api/registry/devices', { token })
      setDevices(d.items || [])
      const a = await api('/api/registry/assignments', { token })
      setAssignments(a.items || [])

      await logEvent(
        { event_type: 'system_registry_loaded', vehicle_type: 'system', role: user....role },
        token,
      )
    } catch (e) {
      const msg = e instanceof Error ... e.message : 'Failed to load registry'
      setErr(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createDevice() {
    setErr('')
    try {
      const res = await api('/api/registry/devices', { method: 'POST', body: form, token })
      setDevices((prev) => [res.device, ...prev])
      setForm({
        label: '',
        device_type: 'router',
        vendor: '',
        model: '',
        serial: '',
        imei: '',
        sim_msisdn: '',
        sim_iccid: '',
        notes: '',
      })
      await logEvent(
        { event_type: 'device_registered', vehicle_type: 'system', meta: { device_id: res.device....id } },
        token,
      )
    } catch (e) {
      const msg = e instanceof Error ... e.message : 'Failed to register device'
      setErr(msg)
    }
  }

  async function assignDevice() {
    setErr('')
    try {
      const body = {
        device_id: assignForm.device_id,
        sacco_id: assignForm.sacco_id,
        matatu_id: assignForm.matatu_id,
        route_id: assignForm.route_id || null,
      }
      const res = await api('/api/registry/assign', { method: 'POST', body, token })
      await loadAll()
      await logEvent({ event_type: 'device_assigned', vehicle_type: 'system', meta: res.assignment }, token)
    } catch (e) {
      const msg = e instanceof Error ... e.message : 'Failed to assign device'
      setErr(msg)
    }
  }

  const assignmentByDevice = useMemo(() => {
    const m = new Map<string, Assignment>()
    assignments.forEach((a) => m.set(a.device_id, a))
    return m
  }, [assignments])

  return (
    <DashboardShell title="System Admin" subtitle="Device Registry & Day-1 data collection">
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={loadAll} disabled={loading}>
          {loading ... 'Refreshing...' : 'Refresh'}
        </button>
        <div className="muted small">
          Devices: <b>{devices.length}</b>
        </div>
        <div className="muted small">
          Assignments: <b>{assignments.length}</b>
        </div>
      </div>

      {err ... (
        <div className="err" style={{ marginTop: 12 }}>
          {err}
        </div>
      ) : null}

      <section className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Register device</h3>

        <div className="grid g4" style={{ gap: 12 }}>
          <label>
            <div className="muted small">Label *</div>
            <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </label>

          <label>
            <div className="muted small">Type *</div>
            <select value={form.device_type} onChange={(e) => setForm((f) => ({ ...f, device_type: e.target.value }))}>
              <option value="router">router</option>
              <option value="tracker">tracker</option>
              <option value="camera">camera</option>
              <option value="wifi_box">wifi_box</option>
              <option value="other">other</option>
            </select>
          </label>

          <label>
            <div className="muted small">Vendor</div>
            <input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} />
          </label>

          <label>
            <div className="muted small">Model</div>
            <input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
          </label>

          <label>
            <div className="muted small">Serial</div>
            <input value={form.serial} onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value }))} />
          </label>

          <label>
            <div className="muted small">IMEI</div>
            <input value={form.imei} onChange={(e) => setForm((f) => ({ ...f, imei: e.target.value }))} />
          </label>

          <label>
            <div className="muted small">SIM MSISDN</div>
            <input value={form.sim_msisdn} onChange={(e) => setForm((f) => ({ ...f, sim_msisdn: e.target.value }))} />
          </label>

          <label>
            <div className="muted small">SIM ICCID</div>
            <input value={form.sim_iccid} onChange={(e) => setForm((f) => ({ ...f, sim_iccid: e.target.value }))} />
          </label>
        </div>

        <div className="row" style={{ gap: 12, marginTop: 12 }}>
          <button className="btn" onClick={createDevice} disabled={!form.label.trim()}>
            Register device
          </button>
          <span className="muted small">Tip: register routers first for the 10-unit trial.</span>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Assign device to matatu</h3>
        <div className="grid g4" style={{ gap: 12 }}>
          <label>
            <div className="muted small">Device</div>
            <select value={assignForm.device_id} onChange={(e) => setAssignForm((f) => ({ ...f, device_id: e.target.value }))}>
              <option value="">- choose -</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} ({d.device_type})
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="muted small">SACCO ID</div>
            <input
              value={assignForm.sacco_id}
              onChange={(e) => setAssignForm((f) => ({ ...f, sacco_id: e.target.value }))}
              placeholder="e.g. demo-sacco-id"
            />
          </label>
          <label>
            <div className="muted small">Matatu ID</div>
            <input
              value={assignForm.matatu_id}
              onChange={(e) => setAssignForm((f) => ({ ...f, matatu_id: e.target.value }))}
              placeholder="matatu uuid/id"
            />
          </label>
          <label>
            <div className="muted small">Route ID (optional)</div>
            <input
              value={assignForm.route_id}
              onChange={(e) => setAssignForm((f) => ({ ...f, route_id: e.target.value }))}
              placeholder="route id"
            />
          </label>
        </div>

        <div className="row" style={{ gap: 12, marginTop: 12 }}>
          <button
            className="btn"
            onClick={assignDevice}
            disabled={!assignForm.device_id || !assignForm.sacco_id || !assignForm.matatu_id}
          >
            Assign
          </button>
          <span className="muted small">This link makes telemetry usable for analytics.</span>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Devices</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Vendor / Model</th>
                <th>IMEI</th>
                <th>SIM</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ... (
                <tr>
                  <td colSpan={6} className="muted">
                    No devices registered yet.
                  </td>
                </tr>
              ) : (
                devices.map((d) => {
                  const as = assignmentByDevice.get(d.id)
                  return (
                    <tr key={d.id}>
                      <td className="mono">{d.label}</td>
                      <td>{d.device_type}</td>
                      <td>{`${d.vendor || ''}${d.model ... ` / ${d.model}` : ''}`}</td>
                      <td className="mono">{d.imei || '-'}</td>
                      <td className="mono">{d.sim_msisdn || '-'}</td>
                      <td className="mono">{as ? `${as.sacco_id} - ${as.matatu_id}` : '-'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardShell>
  )
}