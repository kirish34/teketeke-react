import { useEffect, useState } from 'react'
import SystemDashboard, { type SystemTabId } from './SystemDashboard'
import { SystemPageHeader } from './SystemPageHeader'

const operatorTabs: Array<{ id: SystemTabId; label: string }> = [
  { id: 'saccos', label: 'Operators' },
  { id: 'matatu', label: 'Shuttles' },
  { id: 'taxis', label: 'Taxis' },
  { id: 'bodabodas', label: 'BodaBodas' },
  { id: 'logins', label: 'Logins' },
  { id: 'ussd', label: 'USSD' },
  { id: 'paybill', label: 'Paybill' },
  { id: 'routes', label: 'Routes' },
]

export default function OperatorsPage() {
  const [activeTab, setActiveTab] = useState<SystemTabId>('saccos')
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
        title="Operators"
        subtitle="SACCOs, vehicles, USSD and logins"
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
      />
      <nav className="sys-nav" aria-label="Operator sections">
        {operatorTabs.map((tab) => (
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
        key={`operators-${refreshKey}`}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hideNav
        useShell={false}
      />
    </div>
  )
}
