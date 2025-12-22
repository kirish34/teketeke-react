import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

export function TopBar() {
  const { user, logout, loading } = useAuth()
  const nav = useNavigate()

  const handleLogout = () => {
    logout()
    nav('/login')
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/" className="brand">
          TekeTeke
        </Link>
        <nav className="topnav">
          <Link to="/">Home</Link>
          <Link to="/role">Role Switcher</Link>
        </nav>
      </div>
      <div className="topbar-right">
        {loading ? (
          <span className="pill">Checking...</span>
        ) : user ? (
          <>
            <span className="pill">{user.email || user.role}</span>
            <button className="ghost" onClick={handleLogout}>
              Logout
            </button>
          </>
        ) : (
          <Link to="/login">Login</Link>
        )}
      </div>
    </header>
  )
}
