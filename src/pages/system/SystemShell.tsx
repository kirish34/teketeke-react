import { NavLink, Outlet } from 'react-router-dom'
import DashboardShell from '../../components/DashboardShell'

const systemLinks = [
  { to: '/system', label: 'Overview', end: true },
  { to: '/system/analytics', label: 'Analytics' },
  { to: '/system/operators', label: 'Operators' },
  { to: '/system/payments', label: 'Payments' },
  { to: '/system/finance', label: 'Finance' },
  { to: '/system/comms', label: 'Comms' },
  { to: '/system/registry', label: 'Registry' },
]

export default function SystemShell() {
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
      <Outlet />
    </DashboardShell>
  )
}
