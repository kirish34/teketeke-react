import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../../lib/auth'
import { SystemPageHeader } from './SystemPageHeader'

type Overview = {
  growth?: any
  revenue?: any
  payments?: any
  ops?: any
  top_saccos?: Array<any>
  top_routes?: Array<any>
}

const ranges = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
]

function toRange(days: number) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

function StatCard({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="card" style={{ padding: 12, minWidth: 160 }}>
      <div className="muted tiny">{title}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
      {sub ? <div className="muted tiny">{sub}</div> : null}
    </div>
  )
}

export default function IntelligencePage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState(ranges[1])

  const query = useMemo(() => {
    const r = toRange(range.days)
    const params = new URLSearchParams()
    params.set('from', r.from)
    params.set('to', r.to)
    return params.toString()
  }, [range])

  async function loadOverview() {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/api/admin/intelligence/overview?${query}`)
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      setOverview(json || {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setOverview(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div className="stack">
      <SystemPageHeader
        title="Intelligence"
        subtitle="Growth, revenue, and operational signals"
        onRefresh={loadOverview}
        actions={
          <div className="row" style={{ gap: 8 }}>
            {ranges.map((r) => (
              <button
                key={r.label}
                className={`btn ghost${range.label === r.label ? ' active' : ''}`}
                type="button"
                onClick={() => setRange(r)}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {loading ? <div className="muted small">Loading...</div> : null}
      {error ? <div className="err">{error}</div> : null}

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <StatCard title="New SACCOs" value={overview?.growth?.saccos_new ?? 0} />
        <StatCard title="New Vehicles" value={overview?.growth?.vehicles_new ?? 0} />
        <StatCard title="Active Vehicles" value={overview?.growth?.active_vehicles ?? 0} />
        <StatCard title="Active SACCOs" value={overview?.growth?.active_saccos ?? 0} />
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <StatCard title="Fees collected" value={overview?.revenue?.fees_collected ?? 0} />
        <StatCard title="Withdrawals total" value={overview?.revenue?.payouts_total ?? 0} />
        <StatCard title="Net flow" value={overview?.revenue?.net_flow ?? 0} />
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <StatCard
          title="Success rate"
          value={`${overview?.payments?.success_rate ?? 0}%`}
          sub={`Dup ${overview?.payments?.duplicate_rate ?? 0}% | Fail ${overview?.payments?.failure_rate ?? 0}%`}
        />
        <StatCard title="C2B count" value={overview?.payments?.c2b_count ?? 0} />
        <StatCard title="STK count" value={overview?.payments?.stk_count ?? 0} />
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <StatCard title="Withdrawal fail rate" value={`${overview?.ops?.payout_fail_rate ?? 0}%`} />
        <StatCard title="Recon exceptions" value={overview?.ops?.recon_exception_rate ?? 0} />
        <StatCard title="Open high alerts" value={overview?.ops?.fraud_open_high ?? 0} />
        <StatCard title="Quarantine open" value={overview?.ops?.quarantine_open ?? 0} />
      </div>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Top SACCOs</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sacco</th>
                <th>Volume</th>
                <th>Active vehicles</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.top_saccos || []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No data.
                  </td>
                </tr>
              ) : (
                (overview?.top_saccos || []).map((sacco) => (
                  <tr key={sacco.sacco_id || sacco.name}>
                    <td>{sacco.name || sacco.sacco_id || '-'}</td>
                    <td>{sacco.volume ?? 0}</td>
                    <td>{sacco.active_vehicles ?? '-'}</td>
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
