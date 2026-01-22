import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SystemRegistry from '../../dashboards/SystemRegistry'
import { SystemPageHeader } from './SystemPageHeader'
import { useAuth } from '../../state/auth'

export default function RegistryPage() {
  const { user } = useAuth()
  const { isSuper, isSystem, canRegistryAct } = useMemo(() => {
    const role = (user?.role || '').toLowerCase()
    const superAdmin = role === 'super_admin'
    const systemAdmin = role === 'system_admin' || superAdmin
    return {
      isSuper: superAdmin,
      isSystem: systemAdmin,
      canRegistryAct: systemAdmin,
    }
  }, [user?.role])
  const [refreshKey, setRefreshKey] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    setLastUpdated(new Date())
  }, [])

  const handleRefresh = () => {
    setRefreshKey((key) => key + 1)
    setLastUpdated(new Date())
  }

  return (
    <div className="stack" key={`registry-${refreshKey}`}>
      <SystemPageHeader
        title="Registry"
        subtitle="Devices and assignments"
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost" type="button" onClick={() => navigate('/system')}>
              Back to System
            </button>
            <span className="muted small">
              Mode: {isSuper ? 'Super admin actions enabled' : isSystem ? 'Admin actions enabled' : 'View-only'}
            </span>
          </div>
        }
      />
      <SystemRegistry onBack={() => navigate('/system')} canRegistryAct={canRegistryAct} />
    </div>
  )
}
