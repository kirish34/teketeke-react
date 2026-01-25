import { NavLink, Outlet } from 'react-router-dom'
import DashboardShell from '../../components/DashboardShell'
import { useAuth } from '../../state/auth'

const systemLinks = [
  { to: '/system', label: 'Overview', end: true },
  { to: '/system/analytics', label: 'Analytics' },
  { to: '/system/monitoring', label: 'Monitoring' },
  { to: '/system/intelligence', label: 'Intelligence' },
  { to: '/system/alerts', label: 'Alerts' },
  { to: '/system/admins', label: 'Admins' },
  { to: '/system/quarantine', label: 'Quarantine' },
  { to: '/system/operators', label: 'Operators' },
  { to: '/system/payments', label: 'Payments' },
  { to: '/system/finance', label: 'Finance' },
  { to: '/system/comms', label: 'Comms' },
  { to: '/system/registry', label: 'Registry' },
]

export default function SystemShell() {
  const { user } = useAuth()
  const role = (user?.role || '').toLowerCase()
  const roleLabel = role === 'super_admin' ? 'Super Admin' : role === 'system_admin' ? 'System Admin' : role || 'User'

  return (
    <DashboardShell title="System Admin" subtitle="System navigation" hideNav>
      <div className="muted small" style={{ marginBottom: 8 }}>
        Role: {roleLabel}
      </div>
      <nav className="sys-nav" aria-label="System admin sections">
        {systemLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => `sys-tab${isActive ? ' active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </DashboardShell>
  )
}
