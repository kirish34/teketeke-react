import { Link } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'

const DashHome = () => {
  const links = [
    { to: '/system', label: 'System Admin' },
    { to: '/sacco', label: 'Operator' },
    { to: '/sacco/staff', label: 'Operator Staff' },
    { to: '/matatu/owner', label: 'Matatu Owner' },
    { to: '/matatu/staff', label: 'Matatu Staff' },
    { to: '/taxi', label: 'Taxi' },
    { to: '/boda', label: 'BodaBoda' },
  ]
  return (
    <DashboardShell title="Dashboards" subtitle="React versions live under /app/dash">
      <section className="card">
        <h3 style={{ margin: '0 0 8px' }}>Choose a dashboard</h3>
        <div className="grid g2">
          {links.map((link) => (
            <div key={link.to} className="card" style={{ boxShadow: 'none', borderColor: '#eef2ff' }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{link.label}</div>
              <Link to={link.to}>Open</Link>
            </div>
          ))}
        </div>
      </section>
    </DashboardShell>
  )
}

export default DashHome
