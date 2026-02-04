import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../../lib/auth'
import { SystemPageHeader } from './SystemPageHeader'

type Overview = {
  ok?: boolean
  from?: string
  to?: string
  callbacks?: Record<string, number | boolean | string | null>
  payouts?: Record<string, number | null>
  wallets?: Record<string, number | null>
  jobs?: { enabled?: boolean; waiting?: number; active?: number; completed?: number; failed?: number }
}

type CallbackRow = {
  created_at?: string
  kind?: string
  resource_id?: string
  payload?: { [k: string]: any }
}

type WithdrawalRow = {
  id?: string
  status?: string
  failure_reason?: string | null
  amount?: number | null
  created_at?: string
}

function fmtDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export default function MonitoringPage() {
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([])
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const rangeParams = useMemo(() => {
    const to = new Date()
    let from = new Date()
    if (range === '1h') from = new Date(to.getTime() - 3600 * 1000)
    else if (range === '24h') from = new Date(to.getTime() - 24 * 3600 * 1000)
    else from = new Date(to.getTime() - 7 * 24 * 3600 * 1000)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [range])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [overviewRes, callbacksRes, withdrawalsRes] = await Promise.all([
        authFetch(`/api/admin/monitoring/overview?from=${encodeURIComponent(rangeParams.from)}&to=${encodeURIComponent(rangeParams.to)}`),
        authFetch(
          `/api/admin/monitoring/callbacks?result=failure&limit=20&from=${encodeURIComponent(rangeParams.from)}&to=${encodeURIComponent(rangeParams.to)}`,
        ),
        authFetch(
          `/api/admin/monitoring/payouts?limit=20&from=${encodeURIComponent(rangeParams.from)}&to=${encodeURIComponent(rangeParams.to)}`,
        ),
      ])
      if (overviewRes.status === 403) throw new Error('Not permitted')
      const ov = (await overviewRes.json()) as Overview
      setOverview(ov)

      if (callbacksRes.status === 403) setCallbacks([])
      else setCallbacks(((await callbacksRes.json()) as any)?.items || [])

      if (withdrawalsRes.status === 403) setWithdrawals([])
      else setWithdrawals(((await withdrawalsRes.json()) as any)?.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitoring')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  const callbacksCard = overview?.callbacks || {}
  const withdrawalsCard = overview?.payouts || {}
  const walletsCard = overview?.wallets || {}
  const jobsCard = overview?.jobs || {}

  return (
    <div className="stack">
      <SystemPageHeader
        title="Monitoring"
        subtitle="Platform health, callbacks, withdrawals, and jobs"
        onRefresh={loadAll}
        actions={
          <div className="row" style={{ gap: 8 }}>
            {(['1h', '24h', '7d'] as const).map((r) => (
              <button
                key={r}
                className={`btn ghost${range === r ? ' active' : ''}`}
                type="button"
                onClick={() => setRange(r)}
              >
                {r === '1h' ? 'Last 1h' : r === '24h' ? 'Last 24h' : 'Last 7d'}
              </button>
            ))}
          </div>
        }
      />

      {loading ? <div className="muted small">Loading...</div> : null}
      {error ? <div className="err">{error}</div> : null}

      <div className="grid metrics" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Callback Health</h3>
            <span className="muted small">Accepted / Duplicate / Ignored / Failure</span>
          </div>
          <div className="grid metrics">
            {['accepted', 'duplicate', 'ignored', 'failure'].map((k) => (
              <div key={k} className="metric">
                <div className="k">{k}</div>
                <div className="v">{Number(callbacksCard[k] || 0)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Withdrawal Health</h3>
            <span className="muted small">B2C withdrawals</span>
          </div>
          <div className="grid metrics">
            <div className="metric">
              <div className="k">Total</div>
              <div className="v">{Number(withdrawalsCard.items_total || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Processing</div>
              <div className="v">{Number(withdrawalsCard.items_processing || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Paid</div>
              <div className="v">{Number(withdrawalsCard.items_success || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Failed</div>
              <div className="v">{Number(withdrawalsCard.items_failed || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Avg time (s)</div>
              <div className="v">{withdrawalsCard.avg_time_sec ?? '-'}</div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Wallet Health</h3>
            <span className="muted small">Credits / Debits / Net</span>
          </div>
          <div className="grid metrics">
            <div className="metric">
              <div className="k">Credits</div>
              <div className="v">{Number(walletsCard.credits || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Debits</div>
              <div className="v">{Number(walletsCard.debits || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Net</div>
              <div className="v">{Number(walletsCard.net || 0)}</div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Jobs</h3>
            <span className="muted small">{jobsCard.enabled ? 'Queue enabled' : 'Queue disabled'}</span>
          </div>
          <div className="grid metrics">
            <div className="metric">
              <div className="k">Waiting</div>
              <div className="v">{Number(jobsCard.waiting || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Active</div>
              <div className="v">{Number(jobsCard.active || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Failed</div>
              <div className="v">{Number(jobsCard.failed || 0)}</div>
            </div>
            <div className="metric">
              <div className="k">Completed</div>
              <div className="v">{Number(jobsCard.completed || 0)}</div>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Recent callback failures</h3>
          <span className="muted small">Up to 20</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Result</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {callbacks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No callback failures in range.
                  </td>
                </tr>
              ) : (
                callbacks.map((row, idx) => {
                  const payload = row.payload || {}
                  const reason = payload.reason || payload.error || payload.error_code || '-'
                  return (
                    <tr key={row.resource_id || row.created_at || idx}>
                      <td className="mono">{fmtDate(row.created_at)}</td>
                      <td>{row.kind || '-'}</td>
                      <td>{payload.result || 'failure'}</td>
                      <td>{reason}</td>
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
          <h3 style={{ margin: 0 }}>Recent withdrawal failures</h3>
          <span className="muted small">Up to 20</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No withdrawal failures in range.
                  </td>
                </tr>
              ) : (
                withdrawals.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{fmtDate(row.created_at)}</td>
                    <td>{row.status || '-'}</td>
                    <td>{row.amount ?? '-'}</td>
                    <td>{row.failure_reason || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
