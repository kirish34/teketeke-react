import { useEffect, useMemo, useState } from 'react'
import { ApiError, requestJson } from '../../lib/api'
import { SystemPageHeader } from './SystemPageHeader'

type QuarantineRow = {
  id?: string
  created_at?: string
  operation_type?: string
  operation_id?: string
  entity_type?: string
  entity_id?: string
  reason?: string
  severity?: string
  status?: string
  alert_id?: string | null
  incident_id?: string | null
  released_at?: string | null
  release_note?: string | null
}

const statusOptions = ['quarantined', 'released', 'cancelled']

function fmt(value?: string | null) {
  if (!value) return '-'
  return value
}

function fmtDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export default function QuarantinePage() {
  const [rows, setRows] = useState<QuarantineRow[]>([])
  const [status, setStatus] = useState('quarantined')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<QuarantineRow | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [actionErr, setActionErr] = useState('')

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    params.set('limit', '50')
    return params.toString()
  }, [status])

  async function loadRows() {
    setLoading(true)
    setError(null)
    try {
      const json = await requestJson<{ items?: QuarantineRow[] }>(`/api/admin/quarantine?${query}`)
      setRows(json.items || [])
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Not permitted')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load quarantine list')
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function actOn(id: string, action: 'release' | 'cancel') {
    setActionMsg('')
    setActionErr('')
    const note = window.prompt(`Add note to ${action}`, '')
    if (!note) {
      setActionErr('Note is required')
      return
    }
    try {
      const json = await requestJson<{ error?: string }>(`/api/admin/quarantine/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (json?.error) throw new Error(json?.error || 'Action failed')
      setActionMsg(`${action} ok`)
      await loadRows()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Action failed')
    }
  }

  return (
    <div className="stack">
      <SystemPageHeader
        title="Quarantine"
        subtitle="Preventive controls for risky operations"
        onRefresh={loadRows}
        actions={
          <label className="muted small">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ marginLeft: 6 }}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {loading ? <div className="muted small">Loading...</div> : null}
      {error ? <div className="err">{error}</div> : null}
      {actionMsg ? <div className="muted small">{actionMsg}</div> : null}
      {actionErr ? <div className="err">{actionErr}</div> : null}

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Quarantined operations</h3>
          <span className="muted small">{rows.length} items</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Operation</th>
                <th>Entity</th>
                <th>Reason</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No items.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{fmtDate(r.created_at)}</td>
                    <td>
                      {fmt(r.operation_type)} {r.operation_id}
                    </td>
                    <td>
                      {fmt(r.entity_type)} {r.entity_id || ''}
                    </td>
                    <td>{fmt(r.reason)}</td>
                    <td>{fmt(r.severity)}</td>
                    <td>{fmt(r.status)}</td>
                    <td>
                      <button className="btn ghost" type="button" onClick={() => setSelected(r)}>
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
            <h3 style={{ margin: 0 }}>Details</h3>
            <span className="muted small">{selected.id}</span>
          </div>
          <div className="muted small">{fmtDate(selected.created_at)}</div>
          <div style={{ marginTop: 6 }}>
            <div>
              <strong>Operation:</strong> {fmt(selected.operation_type)} {selected.operation_id}
            </div>
            <div>
              <strong>Entity:</strong> {fmt(selected.entity_type)} {selected.entity_id || ''}
            </div>
            <div>
              <strong>Reason:</strong> {fmt(selected.reason)}
            </div>
            <div>
              <strong>Severity:</strong> {fmt(selected.severity)}
            </div>
            <div>
              <strong>Status:</strong> {fmt(selected.status)}
            </div>
            <div>
              <strong>Alert:</strong> {selected.alert_id || '—'}
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn ghost" type="button" onClick={() => actOn(selected.id || '', 'release')}>
              Release (super)
            </button>
            <button className="btn ghost" type="button" onClick={() => actOn(selected.id || '', 'cancel')}>
              Cancel (super)
            </button>
            <button className="btn ghost" type="button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
