import { useEffect, useState } from 'react'
import SystemDashboard from './SystemDashboard'
import { SystemPageHeader } from './SystemPageHeader'

export default function AnalyticsPage() {
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
        title="Analytics"
        subtitle="Fleet performance and maintenance insights"
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
      />
      <SystemDashboard key={`analytics-${refreshKey}`} activeTab="analytics" hideNav useShell={false} />
    </div>
  )
}
