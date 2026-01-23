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

type CallbackSummaryRow = {
  kind?: string
  result?: string | null
  count?: number
}

type CallbackEvent = {
  created_at?: string
  kind?: string
  resource_id?: string | null
  payload?: { [k: string]: any }
}

type ReconRun = {
  id?: string
  created_at?: string
  from_ts?: string
  to_ts?: string
  totals?: Record<string, any>
}

type ReconException = {
  id?: string
  kind?: string
  provider_ref?: string
  internal_ref?: string | null
  amount?: number | null
  status?: string
  details?: Record<string, any>
  created_at?: string
}

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
  const [callbackSummary, setCallbackSummary] = useState<CallbackSummaryRow[]>([])
  const [callbackEvents, setCallbackEvents] = useState<CallbackEvent[]>([])
  const [callbackError, setCallbackError] = useState<string | null>(null)
  const [reconRuns, setReconRuns] = useState<ReconRun[]>([])
  const [reconExceptions, setReconExceptions] = useState<ReconException[]>([])
  const [reconError, setReconError] = useState<string | null>(null)
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
      try {
        const [summaryRes, eventsRes] = await Promise.all([
          authFetch('/api/admin/callback-audit/summary?from=&to='),
          authFetch('/api/admin/callback-audit/events?limit=10&result=failure'),
        ])
        if (summaryRes.status === 403 || eventsRes.status === 403) {
          setCallbackError('Not permitted')
        } else {
          if (!summaryRes.ok) {
            throw new Error(await summaryRes.text())
          }
          if (!eventsRes.ok) {
            throw new Error(await eventsRes.text())
          }
          const summaryJson = (await summaryRes.json()) as { rows?: CallbackSummaryRow[] }
          const eventsJson = (await eventsRes.json()) as { items?: CallbackEvent[] }
        setCallbackSummary(summaryJson.rows || [])
        setCallbackEvents(eventsJson.items || [])
        setCallbackError(null)
      }
    } catch (cbErr) {
        const msg = cbErr instanceof Error ? cbErr.message : 'Failed to load callback audit'
        setCallbackError(msg)
        setCallbackSummary([])
        setCallbackEvents([])
      }
      setLastUpdated(new Date())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load overview'
      setError(msg)
      setAuditError(err instanceof Error ? err.message : 'Failed to load audit')
    } finally {
      setLoading(false)
    }

    // Reconciliation data (ignore errors separately)
    try {
      const [runsRes, excRes] = await Promise.all([
        authFetch('/api/admin/reconciliation/runs?limit=1'),
        authFetch('/api/admin/reconciliation/exceptions?limit=10'),
      ])
      if (runsRes.status === 403 || excRes.status === 403) {
        setReconError('Not permitted')
      } else {
        if (!runsRes.ok) throw new Error(await runsRes.text())
        if (!excRes.ok) throw new Error(await excRes.text())
        const runsJson = (await runsRes.json()) as { items?: ReconRun[] }
        const excJson = (await excRes.json()) as { items?: ReconException[] }
        setReconRuns(runsJson.items || [])
        setReconExceptions(excJson.items || [])
        setReconError(null)
      }
    } catch (rErr) {
      const msg = rErr instanceof Error ? rErr.message : 'Failed to load reconciliation'
      setReconError(msg)
      setReconRuns([])
      setReconExceptions([])
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

  const callbackCounts = useMemo(() => {
    const counts: Record<string, number> = {
      accepted: 0,
      duplicate: 0,
      ignored: 0,
      failure: 0,
      rejected: 0,
    }
    callbackSummary.forEach((row) => {
      const key = (row.result || '').toLowerCase()
      const target = key === 'rejected' ? 'failure' : key
      counts[target] = (counts[target] || 0) + (row.count || 0)
    })
    return counts
  }, [callbackSummary])

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
          <h3 style={{ margin: 0 }}>M-Pesa callback health</h3>
          <span className="muted small">Last 24h</span>
        </div>
      {callbackError ? (
        <div className="muted small">Callback data unavailable: {callbackError}</div>
      ) : (
        <>
          <div className="grid metrics">
              {['accepted', 'duplicate', 'ignored', 'failure'].map((key) => (
                <div key={key} className="metric">
                  <div className="k">{key}</div>
                  <div className="v">{callbackCounts[key] ?? 0}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="muted small" style={{ marginBottom: 6 }}>
                Recent failures (up to 10)
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Kind</th>
                      <th>Reason</th>
                      <th>Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callbackEvents.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          No recent failures.
                        </td>
                      </tr>
                    ) : (
                      callbackEvents.map((evt, idx) => {
                        const reason =
                          evt.payload?.reason ||
                          evt.payload?.error ||
                          evt.payload?.error_code ||
                          evt.payload?.code ||
                          '-'
                        const when = evt.created_at ? new Date(evt.created_at).toLocaleString() : '-'
                        const key = evt.resource_id || evt.payload?.key || evt.payload?.idempotency_key || '-'
                        return (
                          <tr key={evt.resource_id || evt.created_at || idx}>
                            <td className="mono">{when}</td>
                            <td>{evt.kind || '-'}</td>
                            <td>{reason}</td>
                            <td className="mono">{key}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Reconciliation health</h3>
          <span className="muted small">Last run + exceptions</span>
        </div>
        {reconError ? <div className="muted small">Recon data unavailable: {reconError}</div> : null}
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <button
            className="btn ghost"
            type="button"
            onClick={async () => {
              const now = new Date();
              const from = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
              const to = now.toISOString();
              try {
                const res = await authFetch('/api/admin/reconciliation/run', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ from, to }),
                });
                if (res.status === 403) {
                  setReconError('Not permitted');
                  return;
                }
                if (!res.ok) throw new Error(await res.text());
                setReconError(null);
                void loadAll();
              } catch (err) {
                setReconError(err instanceof Error ? err.message : 'Failed to run reconciliation');
              }
            }}
          >
            Run last 24h
          </button>
          {reconRuns[0]?.created_at ? (
            <span className="muted small">
              Last run: {new Date(reconRuns[0].created_at || '').toLocaleString()}
            </span>
          ) : (
            <span className="muted small">No runs yet</span>
          )}
        </div>
        <div className="grid metrics" style={{ marginTop: 8 }}>
          {['C2B', 'STK', 'B2C'].map((k) => (
            <div key={k} className="metric">
              <div className="k">{k} unmatched/failed</div>
              <div className="v">
                {((reconRuns[0]?.totals || {})[k]?.missing_internal || 0) +
                  ((reconRuns[0]?.totals || {})[k]?.mismatch_amount || 0) +
                  ((reconRuns[0]?.totals || {})[k]?.duplicate || 0)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Recent exceptions (top 10)
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Provider ref</th>
                  <th>Internal</th>
                </tr>
              </thead>
              <tbody>
                {reconExceptions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No exceptions.
                    </td>
                  </tr>
                ) : (
                  reconExceptions.map((ex) => (
                    <tr key={ex.id || ex.provider_ref}>
                      <td className="mono">
                        {ex.created_at ? new Date(ex.created_at).toLocaleString() : '-'}
                      </td>
                      <td>{ex.kind || '-'}</td>
                      <td>{ex.status || '-'}</td>
                      <td className="mono">{ex.provider_ref || '-'}</td>
                      <td className="mono">{ex.internal_ref || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
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
