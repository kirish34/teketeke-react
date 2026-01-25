import { useEffect, useState } from 'react'
import SystemDashboard from './SystemDashboard'
import { SystemPageHeader } from './SystemPageHeader'

export default function AdminsPage() {
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
        title="System Admins"
        subtitle="Create and manage system/super admins with scoped permissions"
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
      />
      <SystemDashboard key={`admins-${refreshKey}`} activeTab="system_admins" hideNav useShell={false} />
    </div>
  )
}
