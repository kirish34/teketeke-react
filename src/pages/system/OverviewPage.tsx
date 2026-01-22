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

type AdminAuditLog = {
  id?: string
  created_at?: string
  actor_user_id?: string
  actor_role?: string
  action?: string
  resource_type?: string | null
  resource_id?: string | null
  payload?: unknown
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

function toList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (Array.isArray((value as { items?: unknown })?.items)) return ((value as { items: unknown[] }).items || []) as T[]
  return []
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<SystemOverview | null>(null)
  const [devices, setDevices] = useState<RegistryDevice[]>([])
  const [assignments, setAssignments] = useState<RegistryAssignment[]>([])
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [overviewRes, deviceResRaw, assignmentResRaw, auditRes] = await Promise.all([
        fetchJson<SystemOverview>('/api/admin/system-overview'),
        fetchJson<unknown>('/api/registry/devices'),
        fetchJson<unknown>('/api/registry/assignments'),
        fetchJson<{ items?: AdminAuditLog[] } | { ok?: boolean; items?: AdminAuditLog[] }>('/api/admin/audit?limit=20'),
      ])
      setOverview(overviewRes || null)
      setDevices(toList<RegistryDevice>(deviceResRaw))
      setAssignments(toList<RegistryAssignment>(assignmentResRaw))
      const auditItems = Array.isArray((auditRes as any)?.items) ? ((auditRes as any).items as AdminAuditLog[]) : []
      setAuditLogs(auditItems.slice(0, 20))
      setLastUpdated(new Date())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load overview'
      setError(msg)
      setAuditError(err instanceof Error ? err.message : 'Failed to load audit')
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
  const deviceIds = useMemo(() => {
    const set = new Set<string>()
    devices.forEach((d) => {
      if (d.id) set.add(String(d.id))
    })
    return set
  }, [devices])
  const assignedDeviceIds = useMemo(() => {
    const set = new Set<string>()
    assignments.forEach((a) => {
      if (a.device_id) set.add(String(a.device_id))
    })
    return set
  }, [assignments])
  const unassignedCount = useMemo(() => {
    let count = 0
    deviceIds.forEach((id) => {
      if (!assignedDeviceIds.has(id)) count += 1
    })
    return count
  }, [assignedDeviceIds, deviceIds])
  const hasUnassignedDevices = unassignedCount > 0
  const devicesTotal = devices.length
  const devicesOnline = devicesTotal - devicesOffline

  const alerts: Alert[] = useMemo(() => {
    const list: Alert[] = []
    const ussdThreshold = Math.max(20, Math.floor((ussdTotal || 0) * 0.1))
    if (ussdAvailable < ussdThreshold) {
      list.push({ message: `USSD pool low (${ussdAvailable}/${ussdTotal || 0})`, to: '/system/operators' })
    }
    if (devicesOffline > 0) {
      list.push({ message: 'Some devices are offline', to: '/system/registry' })
    }
    if (hasUnassignedDevices) {
      list.push({ message: `Unassigned devices: ${unassignedCount}`, to: '/system/registry' })
    }
    return list
  }, [devicesOffline, hasUnassignedDevices, unassignedCount, ussdAvailable, ussdTotal])

  const kpis = [
    { label: 'SACCOs', value: counts.saccos ?? '-' },
    { label: 'Vehicles', value: vehiclesTotal ?? '-' },
    { label: 'Cashiers', value: counts.cashiers ?? '-' },
    { label: 'Tx today', value: counts.tx_today ?? '-' },
    { label: 'USSD (avail / total)', value: `${ussdAvailable || 0} / ${ussdTotal || 0}` },
    { label: 'Devices', value: devicesTotal },
    { label: 'Devices online', value: devicesOnline },
    { label: 'Devices offline', value: devicesOffline },
    { label: 'Active assignments', value: activeAssignments },
  ]

  const statusLabel = loading ? 'Loading' : error ? 'Error' : 'Healthy'

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
          <h3 style={{ margin: 0 }}>Status</h3>
          <span className="muted small">Current state</span>
        </div>
        <div className="muted small">{statusLabel}</div>
      </section>

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
                <Link to={alert.to} className="muted">
                  {alert.message}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Recent admin actions</h3>
          <span className="muted small">Last 20</span>
        </div>
        {auditError ? <div className="err">Audit load error: {auditError}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Role</th>
                <th>Resource</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No recent admin actions.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id || log.created_at}>
                    <td className="mono">{log.created_at ? new Date(log.created_at).toLocaleString() : '-'}</td>
                    <td>{log.action || '-'}</td>
                    <td>{log.actor_role || '-'}</td>
                    <td>
                      {log.resource_type || '-'}
                      {log.resource_id ? ` (${log.resource_id})` : ''}
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
