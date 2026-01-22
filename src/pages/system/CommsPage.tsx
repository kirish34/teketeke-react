import { useEffect, useState } from 'react'
import SystemDashboard from './SystemDashboard'
import { SystemPageHeader } from './SystemPageHeader'

export default function CommsPage() {
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
        title="Comms"
        subtitle="SMS notifications and templates"
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
      />
      <SystemDashboard key={`comms-${refreshKey}`} activeTab="sms" hideNav useShell={false} />
    </div>
  )
}
