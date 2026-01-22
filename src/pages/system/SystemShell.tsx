import { NavLink, Outlet, useLocation } from 'react-router-dom'
import DashboardShell from '../../components/DashboardShell'

const systemLinks = [
  { to: '.', label: 'Overview', end: true },
  { to: 'analytics', label: 'Analytics' },
  { to: 'operators', label: 'Operators' },
  { to: 'payments', label: 'Payments' },
  { to: 'finance', label: 'Finance' },
  { to: 'comms', label: 'Comms' },
  { to: 'registry', label: 'Registry' },
]

export default function SystemShell() {
  const location = useLocation()
  const basePath = location.pathname

  return (
    <DashboardShell title="System Admin" subtitle="System navigation" hideNav>
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
      <Outlet key={basePath} />
    </DashboardShell>
  )
}
