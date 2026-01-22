import { useEffect, useState } from 'react'
import SystemDashboard, { type SystemTabId } from './SystemDashboard'
import { SystemPageHeader } from './SystemPageHeader'

const paymentTabs: Array<{ id: SystemTabId; label: string }> = [
  { id: 'c2b', label: 'C2B Payments' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'quarantine', label: 'Quarantine' },
  { id: 'alerts', label: 'Alerts' },
]

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<SystemTabId>('c2b')
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
        title="Payments"
        subtitle="C2B activity, reconciliation and risk"
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
      />
      <nav className="sys-nav" aria-label="Payments sections">
        {paymentTabs.map((tab) => (
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
        key={`payments-${refreshKey}`}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hideNav
        useShell={false}
      />
    </div>
  )
}
