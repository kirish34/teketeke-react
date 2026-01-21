import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

type Props = {
  title: string
  subtitle?: string
  actions?: ReactNode
  nav?: ReactNode
  navLabel?: string
  hideShellChrome?: boolean
  hideNav?: boolean
  children: ReactNode
}

export const navLinks: Array<{ to: string; label: string; allow: string[] }> = [
  { to: '/system', label: 'System', allow: ['super_admin', 'system_admin'] },
  { to: '/system/registry', label: 'Registry', allow: ['super_admin', 'system_admin'] },
  { to: '/system/payouts', label: 'Payouts', allow: ['super_admin', 'system_admin'] },
  { to: '/sacco/approvals', label: 'Approvals', allow: ['super_admin', 'system_admin', 'sacco_admin'] },
  { to: '/system/worker-monitor', label: 'Worker Monitor', allow: ['super_admin', 'system_admin'] },
  { to: '/ops', label: 'Ops', allow: ['super_admin', 'system_admin'] },
  { to: '/sacco', label: 'Operator', allow: ['super_admin', 'system_admin', 'sacco_admin'] },
  { to: '/sacco/staff', label: 'Operator Staff', allow: ['super_admin', 'sacco_admin', 'sacco_staff'] },
  { to: '/sacco/live-payments', label: 'Live Payments', allow: ['super_admin', 'system_admin', 'sacco_admin', 'sacco_staff'] },
  { to: '/matatu/owner', label: 'Matatu Owner', allow: ['super_admin', 'matatu_owner'] },
  { to: '/matatu/staff', label: 'Matatu Staff', allow: ['super_admin', 'matatu_staff'] },
  { to: '/taxi', label: 'Taxi', allow: ['super_admin', 'taxi'] },
  { to: '/boda', label: 'BodaBoda', allow: ['super_admin', 'boda'] },
]

export function DashboardShell({ title, subtitle, actions, nav, navLabel, hideShellChrome, hideNav, children }: Props) {
  const { user, logout, status, error } = useAuth()
  const navigate = useNavigate()

  const visibleLinks = user ? navLinks.filter((l) => l.allow.includes(user.role)) : navLinks

  async function handleLogout() {
    await logout()
    navigate('/role', { replace: true })
  }

  if (hideShellChrome) {
    return (
      <div className="app-shell">
        <main className="app-main">{children}</main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true" />
          <div>
            <div className="brand-title">{title}</div>
            {subtitle ? <div className="brand-subtitle">{subtitle}</div> : null}
          </div>
        </div>
        <div className="badge" aria-live="polite">
          {status === 'booting' && 'Checking sign-in...'}
          {error && `Auth error: ${error}`}
          {status !== 'booting' && !error && (user?.email ? `Signed in as ${user.email}` : 'Not signed in')}
        </div>
        <button type="button" className="btn ghost" onClick={handleLogout}>
          Logout
        </button>
      </header>

      {!hideNav ? (
        <nav className="tabs" aria-label={navLabel || 'Dashboards'}>
          {nav ??
            visibleLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
              >
                {link.label}
              </NavLink>
            ))}
          {actions}
        </nav>
      ) : null}

      <main className="app-main">{children}</main>
    </div>
  )
}

export default DashboardShell
