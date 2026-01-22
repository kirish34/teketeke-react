import { useEffect, useState } from 'react'
import SystemDashboard from './SystemDashboard'
import { SystemPageHeader } from './SystemPageHeader'

export default function OverviewPage() {
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
        title="System overview"
        subtitle="Platform snapshot and compliance status"
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
      />
      <SystemDashboard key={`overview-${refreshKey}`} activeTab="overview" hideNav useShell={false} />
    </div>
  )
}
