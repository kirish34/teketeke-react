import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { authFetch } from '../../lib/auth'
import { SystemPageHeader } from './SystemPageHeader'

type OverviewCounts = {
  saccos?: number
  matatus?: number
  taxis?: number
  bodas?: number
  cashiers?: number
  tx_today?: number
}

type UssdPool = {
  available?: number
  total?: number
}

type SystemOverview = {
  counts?: OverviewCounts
  ussd_pool?: UssdPool
}

type RegistryDevice = {
  id?: string
  status?: string
}

type RegistryAssignment = {
  device_id?: string
  active?: boolean
}

type Alert = { message: string; to: string }

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return (await res.json()) as T
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<SystemOverview | null>(null)
  const [devices, setDevices] = useState<RegistryDevice[]>([])
  const [assignments, setAssignments] = useState<RegistryAssignment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [overviewRes, deviceRes, assignmentRes] = await Promise.all([
        fetchJson<SystemOverview>('/api/admin/system-overview'),
        fetchJson<RegistryDevice[]>('/api/registry/devices'),
        fetchJson<RegistryAssignment[]>('/api/registry/assignments'),
      ])
      setOverview(overviewRes || null)
      setDevices(deviceRes || [])
      setAssignments(assignmentRes || [])
      setLastUpdated(new Date())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load overview'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const counts = overview?.counts || {}
  const ussd = overview?.ussd_pool || {}
  const ussdAvailable = ussd.available ?? 0
  const ussdTotal = ussd.total ?? 0

  const vehiclesTotal = useMemo(() => {
    const total = (counts.matatus ?? 0) + (counts.taxis ?? 0) + (counts.bodas ?? 0)
    return total > 0 ? total : counts.matatus ?? 0
  }, [counts.bodas, counts.matatus, counts.taxis])

  const devicesOffline = useMemo(
    () => devices.filter((d) => (d.status || '').toLowerCase() === 'offline').length,
    [devices],
  )
  const activeAssignments = useMemo(
    () => assignments.filter((a) => a.active).length,
    [assignments],
  )
  const assignedDeviceIds = useMemo(() => {
    const set = new Set<string>()
    assignments.forEach((a) => {
      if (a.device_id) set.add(a.device_id)
    })
    return set
  }, [assignments])
  const hasUnassignedDevices = devices.length > assignedDeviceIds.size

  const alerts: Alert[] = useMemo(() => {
    const list: Alert[] = []
    if (ussdAvailable < 50) {
      list.push({ message: 'USSD pool low', to: '/system/operators' })
    }
    if (devicesOffline > 0) {
      list.push({ message: 'Some devices are offline', to: '/system/registry' })
    }
    if (hasUnassignedDevices) {
      list.push({ message: 'Unassigned devices present', to: '/system/registry' })
    }
    return list
  }, [devicesOffline, hasUnassignedDevices, ussdAvailable])

  const kpis = [
    { label: 'SACCOs', value: counts.saccos },
    { label: 'Vehicles', value: vehiclesTotal },
    { label: 'Cashiers', value: counts.cashiers },
    { label: 'Tx today', value: counts.tx_today },
    { label: 'USSD (avail / total)', value: `${ussdAvailable || 0} / ${ussdTotal || 0}` },
    { label: 'Devices', value: devices.length },
    { label: 'Devices offline', value: devicesOffline },
    { label: 'Active assignments', value: activeAssignments },
  ]

  return (
    <div className="stack">
      <SystemPageHeader
        title="System Overview"
        subtitle="Live platform health + key numbers"
        lastUpdated={lastUpdated}
        onRefresh={loadAll}
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn ghost" to="/system/operators">
              Operators
            </Link>
            <Link className="btn ghost" to="/system/payments">
              Payments
            </Link>
            <Link className="btn ghost" to="/system/registry">
              Registry
            </Link>
          </div>
        }
      />

      {loading ? <div className="muted small">Loading overview...</div> : null}
      {error ? <div className="err">Error: {error}</div> : null}

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Key metrics</h3>
          <span className="muted small">Up to 8 KPIs</span>
        </div>
        <div className="grid metrics">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="metric">
              <div className="k">{kpi.label}</div>
              <div className="v">{kpi.value ?? '-'}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Alerts</h3>
          <span className="muted small">{alerts.length} issue(s)</span>
        </div>
        {alerts.length === 0 ? (
          <div className="muted">No active alerts.</div>
        ) : (
          <ul style={{ paddingLeft: 16, margin: '8px 0 0' }}>
            {alerts.map((alert) => (
              <li key={alert.message} style={{ marginBottom: 6 }}>
                <span>{alert.message}</span>{' '}
                <Link className="btn ghost" to={alert.to}>
                  Go to section
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Quick actions</h3>
          <span className="muted small">Jump to common tasks</span>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn" to="/system/operators">
            Operators
          </Link>
          <Link className="btn" to="/system/payments">
            Payments
          </Link>
          <Link className="btn" to="/system/finance">
            Finance
          </Link>
          <Link className="btn" to="/system/registry">
            Registry
          </Link>
        </div>
      </section>
    </div>
  )
}
