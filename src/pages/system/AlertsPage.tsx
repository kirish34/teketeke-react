import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../../lib/auth'
import { SystemPageHeader } from './SystemPageHeader'

type AlertRow = {
  id?: string
  created_at?: string
  type?: string
  severity?: string
  status?: string
  summary?: string
  entity_type?: string
  entity_id?: string
  assigned_to?: string | null
  assigned_note?: string | null
  notified_at?: string | null
  last_notified_at?: string | null
  notified_count?: number | null
  details?: Record<string, any>
}

const statusOptions = ['open', 'investigating', 'resolved', 'false_positive']
const severityOptions = ['low', 'medium', 'high']

function fmt(value?: string | null) {
  if (!value) return '-'
  return value
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [severity, setSeverity] = useState('')
  const [type, setType] = useState('')
  const [selected, setSelected] = useState<AlertRow | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [actionErr, setActionErr] = useState('')

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (severity) params.set('severity', severity)
    if (type) params.set('type', type)
    params.set('limit', '50')
    return params.toString()
  }, [severity, status, type])

  async function loadAlerts() {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/api/admin/fraud/alerts?${query}`)
      if (res.status === 403) throw new Error('Not permitted')
      const json = await res.json()
      setAlerts(json.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts')
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAlerts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function updateStatus(id: string, nextStatus: string, note?: string) {
    setActionMsg('')
    setActionErr('')
    try {
      const res = await authFetch(`/api/admin/fraud/alerts/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, note }),
      })
      if (!res.ok) throw new Error(await res.text())
      setActionMsg(`Status updated to ${nextStatus}`)
      await loadAlerts()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function assignAlert(id: string) {
    setActionMsg('')
    setActionErr('')
    const raw = window.prompt('Assign to user id (leave blank to clear)', '')
    if (raw === null) return
    const assigned_to = raw.trim() ? raw.trim() : null
    const note = window.prompt('Add note for assignment (optional)', '') || undefined
    try {
      const res = await authFetch(`/api/admin/fraud/alerts/${encodeURIComponent(id)}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to, note }),
      })
      if (!res.ok) throw new Error(await res.text())
      setActionMsg('Assignment updated')
      await loadAlerts()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Assign failed')
    }
  }

  async function runEscalation() {
    setActionMsg('')
    setActionErr('')
    try {
      const res = await authFetch('/api/admin/fraud/escalate/run', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed to run escalation')
      const msg = json.queued
        ? `Escalation queued (${json.job_id || 'job'})`
        : `Escalation run: escalated ${json.escalated || 0}, reminded ${json.reminded || 0}`
      setActionMsg(msg)
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Escalation failed')
    }
  }

  return (
    <div className="stack">
      <SystemPageHeader
        title="Alerts"
        subtitle="Fraud/anomaly alerts (rules-based)"
        onRefresh={loadAlerts}
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost" type="button" onClick={runEscalation}>
              Run escalation
            </button>
            <label className="muted small">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ marginLeft: 6 }}>
                <option value="">Any</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted small">
              Severity
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ marginLeft: 6 }}>
                <option value="">Any</option>
                {severityOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted small">
              Type
              <input
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="DUPLICATE_ATTEMPT"
                style={{ marginLeft: 6, padding: 6 }}
              />
            </label>
          </div>
        }
      />

      {loading ? <div className="muted small">Loading alerts...</div> : null}
      {error ? <div className="err">{error}</div> : null}
      {actionMsg ? <div className="muted small">{actionMsg}</div> : null}
      {actionErr ? <div className="err">{actionErr}</div> : null}

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Alerts</h3>
          <span className="muted small">{alerts.length} items</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Severity</th>
                <th>Type</th>
                <th>Summary</th>
                <th>Status</th>
                <th>Notified</th>
                <th>Assigned</th>
                <th>Entity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No alerts found.
                  </td>
                </tr>
              ) : (
                alerts.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{fmtDate(a.created_at)}</td>
                    <td>{fmt(a.severity)}</td>
                    <td>{fmt(a.type)}</td>
                    <td>{fmt(a.summary)}</td>
                    <td>{fmt(a.status)}</td>
                    <td className="small">
                      {a.notified_count ? `${a.notified_count}x` : '—'}
                      <br />
                      <span className="muted">{fmtDate(a.last_notified_at || a.notified_at)}</span>
                    </td>
                    <td className="small">
                      {fmt(a.assigned_to)}
                      {a.assigned_note ? <div className="muted tiny">{a.assigned_note}</div> : null}
                    </td>
                    <td>
                      {fmt(a.entity_type)} {a.entity_id || ''}
                    </td>
                    <td>
                      <button className="btn ghost" type="button" onClick={() => setSelected(a)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Alert details</h3>
            <span className="muted small">{selected.id}</span>
          </div>
          <div className="muted small">{fmtDate(selected.created_at)}</div>
          <div style={{ margin: '6px 0' }}>
            <div>
              <strong>Summary:</strong> {selected.summary}
            </div>
            <div>
              <strong>Status:</strong> {selected.status}
            </div>
            <div>
              <strong>Severity:</strong> {selected.severity}
            </div>
            <div>
              <strong>Type:</strong> {selected.type}
            </div>
            <div>
              <strong>Entity:</strong> {selected.entity_type} {selected.entity_id || ''}
            </div>
            <div>
              <strong>Assigned:</strong> {fmt(selected.assigned_to)}{' '}
              {selected.assigned_note ? <span className="muted">({selected.assigned_note})</span> : null}
            </div>
            <div>
              <strong>Notified:</strong> {selected.notified_count || 0}x{' '}
              <span className="muted">{fmtDate(selected.last_notified_at || selected.notified_at)}</span>
            </div>
          </div>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
            {JSON.stringify(selected.details || {}, null, 2)}
          </pre>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {['investigating', 'resolved', 'false_positive'].map((s) => (
              <button
                key={s}
                className="btn ghost"
                type="button"
                onClick={() => {
                  const note = window.prompt(`Add note for status ${s}`, '')
                  void updateStatus(selected.id || '', s, note || undefined)
                }}
              >
                Mark {s}
              </button>
            ))}
            <button className="btn ghost" type="button" onClick={() => void assignAlert(selected.id || '')}>
              Assign
            </button>
          </div>
          <button className="btn ghost" type="button" style={{ marginTop: 8 }} onClick={() => setSelected(null)}>
            Close
          </button>
        </section>
      ) : null}
    </div>
  )
}
