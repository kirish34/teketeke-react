import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../lib/auth'

type RegistryDevice = {
  id?: string
  label?: string
  device_type?: string
  vendor?: string
  model?: string
  serial?: string
  imei?: string
  sim_msisdn?: string
  sim_iccid?: string
  status?: string
  last_seen_at?: string | null
  created_at?: string | null
  notes?: string
}

type RegistryAssignment = {
  id?: string
  device_id?: string
  sacco_id?: string
  matatu_id?: string
  route_id?: string | null
  active?: boolean
  assigned_at?: string | null
}

type SaccoRow = {
  id?: string
  sacco_id?: string
  name?: string
  sacco_name?: string
  display_name?: string
}

type VehicleRow = {
  id?: string
  plate?: string
  registration?: string
  number_plate?: string
  vehicle_type?: string
  body_type?: string
  type?: string
  sacco_id?: string
  sacco?: string
  sacco_name?: string
}

type AdminRoute = {
  id?: string
  name?: string
  sacco_id?: string
  active?: boolean
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, {
    ...(init || {}),
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return (await res.json()) as T
}

async function fetchList<T>(url: string): Promise<T[]> {
  const data = await fetchJson<any>(url)
  if (Array.isArray(data)) return data as T[]
  if (Array.isArray(data?.items)) return data.items as T[]
  return []
}

function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('en-KE')
  } catch {
    return '-'
  }
}

function matatuLabel(row?: VehicleRow | null) {
  if (!row) return '-'
  return row.number_plate || row.plate || row.registration || row.id || '-'
}

type CsvHeader = { key: string; label: string }
type CsvRow = Record<string, string | number | boolean | null | undefined>

function csvEscape(value: CsvRow[keyof CsvRow]) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function buildCsv(headers: CsvHeader[], rows: CsvRow[]) {
  const headerLine = headers.map((h) => csvEscape(h.label)).join(',')
  const body = rows.map((row) => headers.map((h) => csvEscape(row[h.key])).join(',')).join('\n')
  return `${headerLine}\n${body}`
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function downloadJson(filename: string, payload: unknown) {
  downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json')
}

type SystemRegistryProps = {
  onBack?: () => void
  canRegistryAct?: boolean
}

export default function SystemRegistry({ onBack, canRegistryAct = false }: SystemRegistryProps) {

  const [devices, setDevices] = useState<RegistryDevice[]>([])
  const [assignments, setAssignments] = useState<RegistryAssignment[]>([])
  const [saccos, setSaccos] = useState<SaccoRow[]>([])
  const [matatus, setMatatus] = useState<VehicleRow[]>([])
  const [routes, setRoutes] = useState<AdminRoute[]>([])

  const [deviceFilter, setDeviceFilter] = useState('')
  const [assignFilter, setAssignFilter] = useState('')

  const [deviceForm, setDeviceForm] = useState({
    label: '',
    device_type: '',
    vendor: '',
    model: '',
    serial: '',
    imei: '',
    sim_msisdn: '',
    sim_iccid: '',
    notes: '',
  })
  const [deviceMsg, setDeviceMsg] = useState('')
  const [deviceError, setDeviceError] = useState<string | null>(null)

  const [assignForm, setAssignForm] = useState({
    device_id: '',
    sacco_id: '',
    matatu_id: '',
    route_id: '',
  })
  const [assignMsg, setAssignMsg] = useState('')
  const [assignError, setAssignError] = useState<string | null>(null)

  const [editId, setEditId] = useState('')
  const [editForm, setEditForm] = useState({
    label: '',
    device_type: '',
    vendor: '',
    model: '',
    serial: '',
    imei: '',
    sim_msisdn: '',
    sim_iccid: '',
    notes: '',
  })
  const [editMsg, setEditMsg] = useState('')
  const [showTelemetryDocs, setShowTelemetryDocs] = useState(false)

  const deviceMap = useMemo(() => {
    const map = new Map<string, RegistryDevice>()
    devices.forEach((d) => {
      if (d.id) map.set(d.id, d)
    })
    return map
  }, [devices])

  const saccoMap = useMemo(() => {
    const map = new Map<string, SaccoRow>()
    saccos.forEach((s) => {
      const id = s.id || s.sacco_id
      if (id) map.set(id, s)
    })
    return map
  }, [saccos])

  const matatuMap = useMemo(() => {
    const map = new Map<string, VehicleRow>()
    matatus.forEach((m) => {
      if (m.id) map.set(m.id, m)
    })
    return map
  }, [matatus])

  const routeMap = useMemo(() => {
    const map = new Map<string, AdminRoute>()
    routes.forEach((r) => {
      if (r.id) map.set(r.id, r)
    })
    return map
  }, [routes])

  const filteredDevices = useMemo(() => {
    const q = deviceFilter.trim().toLowerCase()
    if (!q) return devices
    return devices.filter((d) => {
      const hay = [
        d.label,
        d.device_type,
        d.vendor,
        d.model,
        d.serial,
        d.imei,
        d.sim_msisdn,
        d.sim_iccid,
        d.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [deviceFilter, devices])

  const filteredAssignments = useMemo(() => {
    const q = assignFilter.trim().toLowerCase()
    if (!q) return assignments
    return assignments.filter((a) => {
      const device = a.device_id ? deviceMap.get(a.device_id) : null
      const matatu = a.matatu_id ? matatuMap.get(a.matatu_id) : null
      const sacco = a.sacco_id ? saccoMap.get(a.sacco_id) : null
      const route = a.route_id ? routeMap.get(a.route_id) : null
      const hay = [
        a.device_id,
        device?.label,
        matatuLabel(matatu),
        a.matatu_id,
        a.sacco_id,
        sacco?.display_name,
        sacco?.name,
        sacco?.sacco_name,
        a.route_id,
        route?.name,
        a.active ? 'active' : 'inactive',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [assignFilter, assignments, deviceMap, matatuMap, saccoMap, routeMap])

  const matatusForSacco = useMemo(() => {
    if (!assignForm.sacco_id) return matatus
    return matatus.filter((m) => (m.sacco_id || m.sacco || '') === assignForm.sacco_id)
  }, [assignForm.sacco_id, matatus])

  async function loadDevices() {
    try {
      const rows = await fetchList<RegistryDevice>('/api/registry/devices')
      setDevices(rows)
      setDeviceError(null)
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Failed to load devices')
    }
  }

  async function loadAssignments() {
    try {
      const rows = await fetchList<RegistryAssignment>('/api/registry/assignments')
      setAssignments(rows)
      setAssignError(null)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Failed to load assignments')
    }
  }

  async function loadRefs() {
    try {
      const [saccoRows, matatuRows, routeRows] = await Promise.all([
        fetchList<SaccoRow>('/api/admin/saccos'),
        fetchList<VehicleRow>('/api/admin/matatus'),
        fetchList<AdminRoute>('/api/admin/routes'),
      ])
      setSaccos(saccoRows)
      setMatatus(matatuRows)
      setRoutes(routeRows)
    } catch (err) {
      console.warn('registry refs load failed', err)
    }
  }

  async function loadAll() {
    await Promise.all([loadDevices(), loadAssignments(), loadRefs()])
  }

  useEffect(() => {
    void loadAll()
  }, [])

  async function createDevice() {
    if (!canRegistryAct) {
      setDeviceMsg('View-only: Registry changes are restricted to system admins.')
      return
    }
    setDeviceMsg('Saving...')
    try {
      const payload = {
        label: deviceForm.label.trim(),
        device_type: deviceForm.device_type.trim(),
        vendor: deviceForm.vendor.trim() || null,
        model: deviceForm.model.trim() || null,
        serial: deviceForm.serial.trim() || null,
        imei: deviceForm.imei.trim() || null,
        sim_msisdn: deviceForm.sim_msisdn.trim() || null,
        sim_iccid: deviceForm.sim_iccid.trim() || null,
        notes: deviceForm.notes.trim() || null,
      }
      if (!payload.label || !payload.device_type) {
        setDeviceMsg('Label and device type are required')
        return
      }
      if (!window.confirm(`Register device "${payload.label}" (${payload.device_type || 'device'})?`)) {
        setDeviceMsg('Cancelled')
        return
      }
      const res = await fetchJson<{ ok: boolean; device?: RegistryDevice; error?: string }>('/api/registry/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(res.error || 'Failed to create device')
      setDeviceMsg('Device registered')
      setDeviceForm({
        label: '',
        device_type: '',
        vendor: '',
        model: '',
        serial: '',
        imei: '',
        sim_msisdn: '',
        sim_iccid: '',
        notes: '',
      })
      await loadDevices()
    } catch (err) {
      setDeviceMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function assignDevice() {
    if (!canRegistryAct) {
      setAssignMsg('View-only: Registry changes are restricted to system admins.')
      return
    }
    setAssignMsg('Assigning...')
    try {
      const payload = {
        device_id: assignForm.device_id,
        sacco_id: assignForm.sacco_id,
        matatu_id: assignForm.matatu_id,
        route_id: assignForm.route_id || null,
      }
      if (!payload.device_id || !payload.sacco_id || !payload.matatu_id) {
        setAssignMsg('Select device, operator, and matatu')
        return
      }
      const deviceLabel = payload.device_id ? deviceMap.get(payload.device_id)?.label || payload.device_id : ''
      if (!window.confirm(`Assign device ${deviceLabel || ''} to operator ${payload.sacco_id} and matatu ${payload.matatu_id}?`)) {
        setAssignMsg('Cancelled')
        return
      }
      const res = await fetchJson<{ ok: boolean; assignment?: RegistryAssignment; error?: string }>(
        '/api/registry/assign',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) throw new Error(res.error || 'Assign failed')
      setAssignMsg('Device assigned')
      setAssignForm({ device_id: '', sacco_id: '', matatu_id: '', route_id: '' })
      await loadAssignments()
    } catch (err) {
      setAssignMsg(err instanceof Error ? err.message : 'Assign failed')
    }
  }

  function startEdit(device: RegistryDevice) {
    if (!canRegistryAct) {
      setEditMsg('View-only: Registry changes are restricted to system admins.')
      return
    }
    if (!device.id) return
    setEditId(device.id)
    setEditMsg('')
    setEditForm({
      label: device.label || '',
      device_type: device.device_type || '',
      vendor: device.vendor || '',
      model: device.model || '',
      serial: device.serial || '',
      imei: device.imei || '',
      sim_msisdn: device.sim_msisdn || '',
      sim_iccid: device.sim_iccid || '',
      notes: device.notes || '',
    })
  }

  async function saveEdit() {
    if (!editId) return
    if (!canRegistryAct) {
      setEditMsg('View-only: Registry changes are restricted to system admins.')
      return
    }
    setEditMsg('Saving...')
    try {
      const payload = {
        label: editForm.label.trim(),
        device_type: editForm.device_type.trim(),
        vendor: editForm.vendor.trim() || null,
        model: editForm.model.trim() || null,
        serial: editForm.serial.trim() || null,
        imei: editForm.imei.trim() || null,
        sim_msisdn: editForm.sim_msisdn.trim() || null,
        sim_iccid: editForm.sim_iccid.trim() || null,
        notes: editForm.notes.trim() || null,
      }
      if (!payload.label || !payload.device_type) {
        setEditMsg('Label and device type are required')
        return
      }
      if (!window.confirm(`Save changes to device ${editId}?`)) {
        setEditMsg('Cancelled')
        return
      }
      const res = await fetchJson<{ ok: boolean; device?: RegistryDevice; error?: string }>(
        `/api/registry/devices/${encodeURIComponent(editId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) throw new Error(res.error || 'Update failed')
      setEditMsg('Device updated')
      setEditId('')
      await loadDevices()
    } catch (err) {
      setEditMsg(err instanceof Error ? err.message : 'Update failed')
    }
  }

  function exportDevicesCsv() {
    const headers: CsvHeader[] = [
      { key: 'label', label: 'Label' },
      { key: 'device_type', label: 'Device type' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'model', label: 'Model' },
      { key: 'serial', label: 'Serial' },
      { key: 'imei', label: 'IMEI' },
      { key: 'sim_msisdn', label: 'SIM MSISDN' },
      { key: 'sim_iccid', label: 'SIM ICCID' },
      { key: 'status', label: 'Status' },
      { key: 'last_seen_at', label: 'Last seen' },
      { key: 'created_at', label: 'Created at' },
      { key: 'notes', label: 'Notes' },
      { key: 'id', label: 'ID' },
    ]
    const rows: CsvRow[] = filteredDevices.map((d) => ({
      label: d.label || '',
      device_type: d.device_type || '',
      vendor: d.vendor || '',
      model: d.model || '',
      serial: d.serial || '',
      imei: d.imei || '',
      sim_msisdn: d.sim_msisdn || '',
      sim_iccid: d.sim_iccid || '',
      status: d.status || '',
      last_seen_at: d.last_seen_at || '',
      created_at: d.created_at || '',
      notes: d.notes || '',
      id: d.id || '',
    }))
    const csv = buildCsv(headers, rows)
    downloadFile('registry-devices.csv', csv, 'text/csv;charset=utf-8;')
  }

  function exportDevicesJson() {
    const rows = filteredDevices.map((d) => ({
      id: d.id || null,
      label: d.label || null,
      device_type: d.device_type || null,
      vendor: d.vendor || null,
      model: d.model || null,
      serial: d.serial || null,
      imei: d.imei || null,
      sim_msisdn: d.sim_msisdn || null,
      sim_iccid: d.sim_iccid || null,
      status: d.status || null,
      last_seen_at: d.last_seen_at || null,
      created_at: d.created_at || null,
      notes: d.notes || null,
    }))
    downloadJson('registry-devices.json', rows)
  }

  function exportAssignmentsCsv() {
    const headers: CsvHeader[] = [
      { key: 'device_label', label: 'Device label' },
      { key: 'device_id', label: 'Device ID' },
      { key: 'matatu', label: 'Matatu' },
      { key: 'matatu_id', label: 'Matatu ID' },
      { key: 'sacco', label: 'Operator' },
      { key: 'sacco_id', label: 'Operator ID' },
      { key: 'route', label: 'Route' },
      { key: 'route_id', label: 'Route ID' },
      { key: 'status', label: 'Status' },
      { key: 'assigned_at', label: 'Assigned at' },
    ]
    const rows: CsvRow[] = filteredAssignments.map((a) => {
      const device = a.device_id ? deviceMap.get(a.device_id) : null
      const matatu = a.matatu_id ? matatuMap.get(a.matatu_id) : null
      const sacco = a.sacco_id ? saccoMap.get(a.sacco_id) : null
      const route = a.route_id ? routeMap.get(a.route_id) : null
      return {
        device_label: device?.label || '',
        device_id: a.device_id || '',
        matatu: matatuLabel(matatu),
        matatu_id: a.matatu_id || '',
        sacco: sacco?.display_name || sacco?.name || sacco?.sacco_name || '',
        sacco_id: a.sacco_id || '',
        route: route?.name || '',
        route_id: a.route_id || '',
        status: a.active ? 'active' : 'inactive',
        assigned_at: a.assigned_at || '',
      }
    })
    const csv = buildCsv(headers, rows)
    downloadFile('registry-assignments.csv', csv, 'text/csv;charset=utf-8;')
  }

  function exportAssignmentsJson() {
    const rows = filteredAssignments.map((a) => {
      const device = a.device_id ? deviceMap.get(a.device_id) : null
      const matatu = a.matatu_id ? matatuMap.get(a.matatu_id) : null
      const sacco = a.sacco_id ? saccoMap.get(a.sacco_id) : null
      const route = a.route_id ? routeMap.get(a.route_id) : null
      return {
        id: a.id || null,
        device_id: a.device_id || null,
        device_label: device?.label || null,
        matatu_id: a.matatu_id || null,
        matatu: matatuLabel(matatu),
        sacco_id: a.sacco_id || null,
        sacco: sacco?.display_name || sacco?.name || sacco?.sacco_name || null,
        route_id: a.route_id || null,
        route: route?.name || null,
        active: a.active ?? null,
        assigned_at: a.assigned_at || null,
      }
    })
    downloadJson('registry-assignments.json', rows)
  }

  const totalAssignments = assignments.length
  const activeAssignments = assignments.filter((a) => a.active).length

  return (
    <>
      {onBack ? (
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <button type="button" className="btn ghost" onClick={onBack}>
            ← Back to System
          </button>
          <span className="muted small">Registry tools</span>
        </div>
      ) : null}

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Registry overview</h3>
          <button className="btn ghost" type="button" onClick={loadAll}>
            Refresh
          </button>
        </div>
        <div className="grid metrics">
          <div className="metric">
            <div className="k">Devices</div>
            <div className="v">{devices.length}</div>
          </div>
          <div className="metric">
            <div className="k">Assignments</div>
            <div className="v">{totalAssignments}</div>
          </div>
          <div className="metric">
            <div className="k">Active assignments</div>
            <div className="v">{activeAssignments}</div>
          </div>
          <div className="metric">
            <div className="k">Operators</div>
            <div className="v">{saccos.length}</div>
          </div>
          <div className="metric">
            <div className="k">Matatus</div>
            <div className="v">{matatus.length}</div>
          </div>
        </div>
      </section>

      {!canRegistryAct ? (
        <div className="err" style={{ margin: '0 0 12px' }}>
          🔒 View-only: Registry changes are restricted to system admins.
        </div>
      ) : null}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Register device</h3>
        <div className="grid g2">
          <label className="muted small">
            Label
            <input
              className="input"
              value={deviceForm.label}
              onChange={(e) => setDeviceForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Tracker A1"
              disabled={!canRegistryAct}
            />
          </label>
          <label className="muted small">
            Device type
            <input
              className="input"
              list="device-type-options"
              value={deviceForm.device_type}
              onChange={(e) => setDeviceForm((f) => ({ ...f, device_type: e.target.value }))}
              placeholder="GPS, OBD, Router"
              disabled={!canRegistryAct}
            />
          </label>
          <label className="muted small">
            Vendor
            <input
              className="input"
              value={deviceForm.vendor}
              onChange={(e) => setDeviceForm((f) => ({ ...f, vendor: e.target.value }))}
              disabled={!canRegistryAct}
            />
          </label>
          <label className="muted small">
            Model
            <input
              className="input"
              value={deviceForm.model}
              onChange={(e) => setDeviceForm((f) => ({ ...f, model: e.target.value }))}
              disabled={!canRegistryAct}
            />
          </label>
          <label className="muted small">
            Serial
            <input
              className="input"
              value={deviceForm.serial}
              onChange={(e) => setDeviceForm((f) => ({ ...f, serial: e.target.value }))}
              disabled={!canRegistryAct}
            />
          </label>
          <label className="muted small">
            IMEI
            <input
              className="input"
              value={deviceForm.imei}
              onChange={(e) => setDeviceForm((f) => ({ ...f, imei: e.target.value }))}
              disabled={!canRegistryAct}
            />
          </label>
          <label className="muted small">
            SIM MSISDN
            <input
              className="input"
              value={deviceForm.sim_msisdn}
              onChange={(e) => setDeviceForm((f) => ({ ...f, sim_msisdn: e.target.value }))}
              disabled={!canRegistryAct}
            />
          </label>
          <label className="muted small">
            SIM ICCID
            <input
              className="input"
              value={deviceForm.sim_iccid}
              onChange={(e) => setDeviceForm((f) => ({ ...f, sim_iccid: e.target.value }))}
              disabled={!canRegistryAct}
            />
          </label>
          <label className="muted small">
            Notes
            <input
              className="input"
              value={deviceForm.notes}
              onChange={(e) => setDeviceForm((f) => ({ ...f, notes: e.target.value }))}
              disabled={!canRegistryAct}
            />
          </label>
        </div>
        <datalist id="device-type-options">
          <option value="GPS" />
          <option value="OBD" />
          <option value="ROUTER" />
          <option value="TABLET" />
          <option value="CAMERA" />
        </datalist>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" type="button" onClick={createDevice} disabled={!canRegistryAct}>
            {canRegistryAct ? 'Create device' : '🔒 System admin only'}
          </button>
          <span className="muted small">{deviceMsg}</span>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Assign device to matatu</h3>
        {assignError ? <div className="err">Assignment error: {assignError}</div> : null}
        <div className="row">
          <select
            value={assignForm.device_id}
            onChange={(e) => setAssignForm((f) => ({ ...f, device_id: e.target.value }))}
            style={{ padding: 10, minWidth: 220 }}
            disabled={!canRegistryAct}
          >
            <option value="">Select device</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id || ''}>
                {d.label || d.id || 'Unnamed'} ({d.device_type || 'device'})
              </option>
            ))}
          </select>
          <select
            value={assignForm.sacco_id}
            onChange={(e) =>
              setAssignForm((f) => ({ ...f, sacco_id: e.target.value, matatu_id: '', route_id: '' }))
            }
            style={{ padding: 10, minWidth: 200 }}
            disabled={!canRegistryAct}
          >
            <option value="">Select operator</option>
            {saccos.map((s) => (
              <option key={s.id || s.sacco_id} value={s.id || s.sacco_id || ''}>
                {s.display_name || s.name || s.sacco_name || s.sacco_id}
              </option>
            ))}
          </select>
          <select
            value={assignForm.matatu_id}
            onChange={(e) => setAssignForm((f) => ({ ...f, matatu_id: e.target.value }))}
            style={{ padding: 10, minWidth: 220 }}
            disabled={!canRegistryAct}
          >
            <option value="">Select matatu</option>
            {matatusForSacco.map((m) => (
              <option key={m.id || matatuLabel(m)} value={m.id || ''}>
                {matatuLabel(m)} {m.sacco_name ? `(${m.sacco_name})` : ''}
              </option>
            ))}
          </select>
          <select
            value={assignForm.route_id}
            onChange={(e) => setAssignForm((f) => ({ ...f, route_id: e.target.value }))}
            style={{ padding: 10, minWidth: 200 }}
            disabled={!canRegistryAct}
          >
            <option value="">Route (optional)</option>
            {routes.map((r) => (
              <option key={r.id || r.name} value={r.id || ''}>
                {r.name || r.id}
              </option>
            ))}
          </select>
          <button className="btn" type="button" onClick={assignDevice} disabled={!canRegistryAct}>
            {canRegistryAct ? 'Assign device' : '🔒 System admin only'}
          </button>
          <span className="muted small">{assignMsg}</span>
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Devices</h3>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Search devices"
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
              style={{ maxWidth: 240 }}
            />
            <button className="btn ghost" type="button" onClick={exportDevicesCsv}>
              Export CSV
            </button>
            <button className="btn ghost" type="button" onClick={exportDevicesJson}>
              Export JSON
            </button>
          </div>
        </div>
        {deviceError ? <div className="err">Device error: {deviceError}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Serial / IMEI</th>
                <th>SIM</th>
                <th>Status</th>
                <th>Last seen</th>
                <th>ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    No devices yet.
                  </td>
                </tr>
              ) : (
                filteredDevices.map((d) => {
                  const status = (d.status || 'unknown').toLowerCase()
                  const statusStyle =
                    status === 'online'
                      ? { background: '#dcfce7', color: '#166534' }
                      : status === 'offline'
                        ? { background: '#fee2e2', color: '#991b1b' }
                        : { background: '#e2e8f0', color: '#0f172a' }
                  return (
                    <tr key={d.id || d.label}>
                      <td>{d.label || '-'}</td>
                      <td>{d.device_type || '-'}</td>
                      <td>{d.serial || d.imei || '-'}</td>
                      <td>{d.sim_msisdn || d.sim_iccid || '-'}</td>
                      <td>
                        <span
                          style={{
                            ...statusStyle,
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            display: 'inline-block',
                          }}
                        >
                          {d.status || 'unknown'}
                        </span>
                      </td>
                      <td>{fmtDate(d.last_seen_at || d.created_at)}</td>
                      <td className="mono">{d.id || '-'}</td>
                      <td>
                        <button className="btn ghost" type="button" onClick={() => startEdit(d)} disabled={!canRegistryAct}>
                          {canRegistryAct ? 'Edit' : '🔒'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editId ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Edit device</h3>
            <span className="muted small">ID: {editId}</span>
          </div>
          <div className="grid g2">
            <label className="muted small">
              Label
              <input
                className="input"
                value={editForm.label}
                onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
            <label className="muted small">
              Device type
              <input
                className="input"
                list="device-type-options"
                value={editForm.device_type}
                onChange={(e) => setEditForm((f) => ({ ...f, device_type: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
            <label className="muted small">
              Vendor
              <input
                className="input"
                value={editForm.vendor}
                onChange={(e) => setEditForm((f) => ({ ...f, vendor: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
            <label className="muted small">
              Model
              <input
                className="input"
                value={editForm.model}
                onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
            <label className="muted small">
              Serial
              <input
                className="input"
                value={editForm.serial}
                onChange={(e) => setEditForm((f) => ({ ...f, serial: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
            <label className="muted small">
              IMEI
              <input
                className="input"
                value={editForm.imei}
                onChange={(e) => setEditForm((f) => ({ ...f, imei: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
            <label className="muted small">
              SIM MSISDN
              <input
                className="input"
                value={editForm.sim_msisdn}
                onChange={(e) => setEditForm((f) => ({ ...f, sim_msisdn: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
            <label className="muted small">
              SIM ICCID
              <input
                className="input"
                value={editForm.sim_iccid}
                onChange={(e) => setEditForm((f) => ({ ...f, sim_iccid: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
            <label className="muted small">
              Notes
              <input
                className="input"
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                disabled={!canRegistryAct}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" type="button" onClick={saveEdit} disabled={!canRegistryAct}>
              {canRegistryAct ? 'Save changes' : '🔒 System admin only'}
            </button>
            <button className="btn ghost" type="button" onClick={() => setEditId('')}>
              Cancel
            </button>
            <span className="muted small">{editMsg}</span>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Assignments</h3>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Search assignments"
              value={assignFilter}
              onChange={(e) => setAssignFilter(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <button className="btn ghost" type="button" onClick={exportAssignmentsCsv}>
              Export CSV
            </button>
            <button className="btn ghost" type="button" onClick={exportAssignmentsJson}>
              Export JSON
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Matatu</th>
                <th>Operator</th>
                <th>Route</th>
                <th>Status</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No assignments found.
                  </td>
                </tr>
              ) : (
                filteredAssignments.map((a) => {
                  const device = a.device_id ? deviceMap.get(a.device_id) : null
                  const matatu = a.matatu_id ? matatuMap.get(a.matatu_id) : null
                  const sacco = a.sacco_id ? saccoMap.get(a.sacco_id) : null
                  const route = a.route_id ? routeMap.get(a.route_id) : null
                  return (
                    <tr key={a.id || `${a.device_id}-${a.matatu_id}-${a.assigned_at}`}>
                      <td>{device?.label || a.device_id || '-'}</td>
                      <td>{matatuLabel(matatu)}</td>
                      <td>{sacco?.display_name || sacco?.name || sacco?.sacco_name || a.sacco_id || '-'}</td>
                      <td>{route?.name || a.route_id || '-'}</td>
                      <td>{a.active ? 'Active' : 'Inactive'}</td>
                      <td>{fmtDate(a.assigned_at)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Telemetry ingestion</h3>
          <button className="btn ghost" type="button" onClick={() => setShowTelemetryDocs((v) => !v)}>
            {showTelemetryDocs ? 'Hide docs' : 'Show docs'}
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>
          Device heartbeat and telemetry endpoints. Docs are available below.
        </p>
        {showTelemetryDocs ? (
          <>
            <p className="muted">
              Devices post heartbeat and telemetry to the backend using the shared <code>TELEMETRY_TOKEN</code> header. JSONL
              files are written to <code>data/heartbeats</code> and <code>data/telemetry</code> when storage is enabled.
            </p>
            <ul className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
              <li>Route speed + delay zones</li>
              <li>Trip time distribution</li>
              <li>Load factor from passenger_count</li>
              <li>Peak stops</li>
              <li>Performance vs fuel and engine signals</li>
            </ul>
            <p className="muted small" style={{ marginTop: 8 }}>
              Set <code>TELEMETRY_ENABLE_STORAGE=true</code> to persist JSONL. Device status updates to online when heartbeat or
              telemetry is received.
            </p>
            <div className="grid g2">
              <div>
                <div className="muted small">Heartbeat endpoint</div>
                <pre
                  className="mono"
                  style={{
                    background: '#f8fafc',
                    borderRadius: 8,
                    padding: 12,
                    border: '1px solid rgba(15, 23, 42, 0.08)',
                    overflowX: 'auto',
                  }}
                >
{`POST /api/device/heartbeat
Headers: x-telemetry-key: TELEMETRY_TOKEN
Body:
{
  "device_id": "dev_123",
  "sacco_id": "sacco_1",
  "matatu_id": "matatu_9",
  "route_id": "route_5",
  "signal": -71,
  "voltage": 12.4,
  "temp": 39
}`}
                </pre>
              </div>
              <div>
                <div className="muted small">Telemetry endpoint</div>
                <pre
                  className="mono"
                  style={{
                    background: '#f8fafc',
                    borderRadius: 8,
                    padding: 12,
                    border: '1px solid rgba(15, 23, 42, 0.08)',
                    overflowX: 'auto',
                  }}
                >
{`POST /api/device/telemetry
Headers: x-telemetry-key: TELEMETRY_TOKEN
Body:
{
  "device_id": "dev_123",
  "sacco_id": "sacco_1",
  "matatu_id": "matatu_9",
  "route_id": "route_5",
  "lat": -1.286,
  "lon": 36.817,
  "speed_kph": 38,
  "heading": 124,
  "passenger_count": 11,
  "engine_temp": 82,
  "fuel_est": 0.62
}`}
                </pre>
              </div>
            </div>
          </>
        ) : (
          <div className="muted small">Docs collapsed. Expand to view request examples.</div>
        )}
      </section>
    </>
  )
}
