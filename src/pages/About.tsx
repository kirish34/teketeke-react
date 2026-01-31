import { useMemo } from "react"
import DashboardShell from "../components/DashboardShell"

const About = () => {
  const appVersion = import.meta.env.VITE_APP_VERSION || "current"
  const buildDate = useMemo(() => import.meta.env.VITE_BUILD_DATE || new Date().toISOString().slice(0, 10), [])

  return (
    <DashboardShell title="About" subtitle="TekeTeke Staff Dashboard" navLabel="About">
      <section className="card about-card" style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ marginTop: 0 }}>TekeTeke Staff Dashboard</h2>
        <p className="muted">
          TekeTeke is a digital operations platform designed to simplify daily collections, trip tracking, and payment visibility for public transport operators.
        </p>
        <p className="muted">
          The Staff Dashboard provides real-time payment monitoring, shift and trip management, and transparent record-keeping to ensure that every payment is captured, accounted for, and never lost — even during network delays or operational oversights.
        </p>

        <h4 style={{ marginBottom: 6 }}>Key Principles</h4>
        <ul className="muted">
          <li><strong>Never lose money</strong> — All payments are recorded instantly, whether or not a shift or trip was started.</li>
          <li><strong>Real-time visibility</strong> — Live payments update automatically, giving staff confidence and clarity throughout the day.</li>
          <li><strong>Operational simplicity</strong> — Designed for use in fast-moving environments with minimal training required.</li>
          <li><strong>Accountability & transparency</strong> — Clear separation of live, confirmed, and unassigned payments for easy reconciliation.</li>
        </ul>

        <h4 style={{ marginBottom: 6 }}>Automatic Protection Features</h4>
        <ul className="muted">
          <li>Automatic shift and trip creation when the first payment is received</li>
          <li>Safe handling of off-shift and off-trip payments</li>
          <li>Assignment and confirmation tools to correct missed actions</li>
          <li>Secure, auditable records for owners and SACCOs</li>
        </ul>

        <h4 style={{ marginBottom: 6 }}>Ownership</h4>
        <p className="muted">
          TekeTeke is a product of Sky Yalla Ltd, developed to support transport operators with reliable, scalable, and compliant digital payment infrastructure.
        </p>

        <h4 style={{ marginBottom: 6 }}>Contact & Support</h4>
        <p className="muted" style={{ marginBottom: 8 }}>
          For system support, account assistance, or operational questions, please contact:
        </p>
        <ul className="muted" style={{ listStyle: "none", paddingLeft: 0, marginTop: 0 }}>
          <li>
            Email:{" "}
            <a href="mailto:businesses@skyyalla.com" className="about-link">
              businesses@skyyalla.com
            </a>
          </li>
          <li>
            Phone:{" "}
            <a href="tel:0758222666" className="about-link">
              0758 222 666
            </a>
          </li>
        </ul>

        <div className="muted small" style={{ marginTop: 12 }}>
          © Sky Yalla Ltd. All rights reserved.
          <br />
          Version: {appVersion} · Build: {buildDate}
        </div>
      </section>
    </DashboardShell>
  )
}

export default About
