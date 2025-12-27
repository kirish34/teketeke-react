import { useNavigate } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'

type SystemTabId =
  | 'overview'
  | 'finance'
  | 'saccos'
  | 'matatu'
  | 'taxis'
  | 'bodabodas'
  | 'ussd'
  | 'logins'
  | 'routes'
  | 'registry'

export default function SystemRegistry() {
  const navigate = useNavigate()
  const tabs: Array<{ id: SystemTabId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'finance', label: 'Finance' },
    { id: 'saccos', label: 'SACCOs' },
    { id: 'matatu', label: 'Matatu' },
    { id: 'taxis', label: 'Taxis' },
    { id: 'bodabodas', label: 'BodaBodas' },
    { id: 'ussd', label: 'USSD Pool' },
    { id: 'logins', label: 'Logins' },
    { id: 'routes', label: 'Routes Overview' },
    { id: 'registry', label: 'System Registry' },
  ]
  return (
    <DashboardShell title="System Registry" hideNav>
      <nav className="sys-nav" aria-label="System admin sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sys-tab${t.id === 'registry' ? ' active' : ''}`}
            onClick={() => {
              if (t.id === 'registry') return
              navigate('/system', { state: { tab: t.id } })
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="card">
        <h3 style={{ margin: '0 0 8px' }}>System Registry</h3>
        <p className="muted">Registry view is temporarily unavailable.</p>
      </div>
    </DashboardShell>
  )
}
