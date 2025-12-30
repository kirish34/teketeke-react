import { useMemo } from 'react'
import type { VehicleCareLog } from './vehicleCare.api'
import { safeNumber } from './vehicleCare.utils'

type Props = {
  logs: VehicleCareLog[]
}

function daysSince(dateValue?: string | null) {
  if (!dateValue) return Number.POSITIVE_INFINITY
  const dt = new Date(dateValue)
  if (Number.isNaN(dt.getTime())) return Number.POSITIVE_INFINITY
  const diffMs = Date.now() - dt.getTime()
  return diffMs / (1000 * 60 * 60 * 24)
}

export default function VehicleCareAnalytics({ logs }: Props) {
  const summary = useMemo(() => {
    const openCount = logs.filter((log) => (log.status || '').toUpperCase() === 'OPEN').length
    const inProgressCount = logs.filter((log) => (log.status || '').toUpperCase() === 'IN_PROGRESS').length
    const resolvedRecent = logs.filter((log) => {
      if ((log.status || '').toUpperCase() !== 'RESOLVED') return false
      const ref = log.resolved_at || log.occurred_at || log.created_at
      return daysSince(ref) <= 7
    }).length

    const last30 = logs.filter((log) => daysSince(log.occurred_at || log.created_at) <= 30)
    const totalCost = last30.reduce((sum, log) => sum + safeNumber(log.total_cost_kes), 0)
    const downtime = last30.reduce((sum, log) => sum + safeNumber(log.downtime_days), 0)

    const categoryCounts = new Map<string, number>()
    last30.forEach((log) => {
      const key = (log.issue_category || '').toUpperCase() || 'UNKNOWN'
      categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1)
    })
    let topCategory = '-'
    let topCount = 0
    categoryCounts.forEach((count, key) => {
      if (count > topCount) {
        topCategory = key
        topCount = count
      }
    })

    return {
      openCount,
      inProgressCount,
      resolvedRecent,
      totalCost,
      downtime,
      topCategory,
    }
  }, [logs])

  return (
    <section className="card">
      <div className="topline">
        <h3 style={{ margin: 0 }}>Vehicle Care Snapshot</h3>
        <span className="muted small">Last 30 days</span>
      </div>
      <div className="grid metrics">
        <div className="metric">
          <div className="k">OPEN issues</div>
          <div className="v">{summary.openCount}</div>
        </div>
        <div className="metric">
          <div className="k">In progress</div>
          <div className="v">{summary.inProgressCount}</div>
        </div>
        <div className="metric">
          <div className="k">Resolved (7 days)</div>
          <div className="v">{summary.resolvedRecent}</div>
        </div>
        <div className="metric">
          <div className="k">Total cost (KES)</div>
          <div className="v">{summary.totalCost.toLocaleString('en-KE')}</div>
        </div>
        <div className="metric">
          <div className="k">Downtime days</div>
          <div className="v">{summary.downtime.toLocaleString('en-KE')}</div>
        </div>
        <div className="metric">
          <div className="k">Top category</div>
          <div className="v">{summary.topCategory}</div>
        </div>
      </div>
    </section>
  )
}
