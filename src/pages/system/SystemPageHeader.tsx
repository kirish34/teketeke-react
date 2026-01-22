import type { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  lastUpdated?: Date | null
  onRefresh?: () => void
  actions?: ReactNode
}

export function SystemPageHeader({ title, subtitle, lastUpdated, onRefresh, actions }: Props) {
  const timestamp = lastUpdated ? lastUpdated.toLocaleString('en-KE') : null
  return (
    <div className="topline" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>{title}</h2>
        {subtitle ? (
          <p className="muted small" style={{ margin: 0 }}>
            {subtitle}
          </p>
        ) : null}
        {timestamp ? (
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Last updated {timestamp}
          </p>
        ) : null}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {onRefresh ? (
          <button className="btn ghost" type="button" onClick={onRefresh}>
            Refresh
          </button>
        ) : null}
        {actions}
      </div>
    </div>
  )
}
