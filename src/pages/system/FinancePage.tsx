import { useEffect, useMemo, useState } from 'react'
import SystemDashboard, { type SystemTabId } from './SystemDashboard'
import { SystemPageHeader } from './SystemPageHeader'
import { useAuth } from '../../state/auth'

const financeTabs: Array<{ id: SystemTabId; label: string }> = [
  { id: 'finance', label: 'Finance' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'payout_approvals', label: 'Approvals' },
  { id: 'worker_monitor', label: 'Workers' },
]

type FinancePageProps = {
  initialTab?: SystemTabId
}

export default function FinancePage({ initialTab }: FinancePageProps) {
  const { user } = useAuth()
  const canFinanceAct = useMemo(() => {
    const role = (user?.role || '').toLowerCase()
    return role === 'system_admin' || role === 'super_admin'
  }, [user?.role])
  const [activeTab, setActiveTab] = useState<SystemTabId>(initialTab ?? 'finance')
  const [refreshKey, setRefreshKey] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    setLastUpdated(new Date())
  }, [])

  const handleRefresh = () => {
    setRefreshKey((key) => key + 1)
    setLastUpdated(new Date())
  }

  return (
    <div className="stack">
      <SystemPageHeader
        title="Finance"
        subtitle="Wallets, payouts, and worker monitoring"
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
        actions={<span className="muted small">Mode: {canFinanceAct ? 'Admin actions enabled' : 'Monitoring only'}</span>}
      />
      <nav className="sys-nav" aria-label="Finance sections">
        {financeTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`sys-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <SystemDashboard
        key={`finance-${refreshKey}`}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hideNav
        useShell={false}
        canFinanceAct={canFinanceAct}
      />
    </div>
  )
}
