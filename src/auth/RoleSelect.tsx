import { Link, useLocation } from "react-router-dom";

type DashCard = {
  code: string;
  title: string;
  desc: string;
  next: string;
};

const dashboards: DashCard[] = [
  { code: "SC", title: "SACCO Admin", desc: "Manage members, vehicles, transactions, loans and reports.", next: "/sacco" },
  { code: "SS", title: "SACCO Staff", desc: "Cash desk: record fees, savings and loan repayments.", next: "/sacco/staff" },
  { code: "MS", title: "Matatu Staff", desc: "Trip operations and manual cash entries.", next: "/matatu/staff" },
  { code: "MO", title: "Matatu Owner", desc: "View vehicle details, staff and daily transactions.", next: "/matatu/owner" },
  { code: "TX", title: "Taxi", desc: "Daily cash, expenses and net position.", next: "/taxi" },
  { code: "BB", title: "BodaBoda", desc: "Collect cash, track expenses and view totals.", next: "/boda" },
  { code: "SA", title: "System Admin", desc: "Platform settings, alerts and audit logs.", next: "/system" },
];

export function RoleSelect() {
  const location = useLocation();
  const incomingNext = new URLSearchParams(location.search).get("next") || "";

  return (
    <div
      className="app-shell"
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 35%, #0ea5e9 70%, #e0f2fe 100%)",
      }}
    >
      <header className="app-bar" style={{ background: "transparent", border: "none", color: "#0b1b36" }}>
        <div className="brand">
          <span className="brand-logo" aria-hidden="true" />
          <div>
            <div className="brand-kicker">TEKETEKE</div>
            <div className="brand-title">Choose your role</div>
            <div className="brand-subtitle">
              Select the console you want to open. Your access follows the permissions on your account.
            </div>
          </div>
        </div>
        <div className="badge" style={{ background: "#e0f2fe", color: "#0f172a" }}>
          Not signed in
        </div>
      </header>

      <main className="app-main" style={{ paddingTop: 12 }}>
        <section
          className="card"
          style={{
            borderColor: "rgba(15,23,42,0.08)",
            boxShadow: "0 18px 50px rgba(15,23,42,0.12)",
            background: "rgba(255,255,255,0.92)",
          }}
        >
          <div className="role-grid">
            {dashboards.map((d) => {
              const params = new URLSearchParams();
              params.set("next", d.next);
              if (incomingNext) params.set("from", incomingNext);
              return (
                <Link
                  key={d.next}
                  to={`/login?${params.toString()}`}
                  className="card"
                  style={{
                    boxShadow: "none",
                    borderColor: "#eef2ff",
                    transition: "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 10px 24px rgba(15,23,42,0.08)";
                    e.currentTarget.style.borderColor = "#bfdbfe";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.borderColor = "#eef2ff";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span className="badge" style={{ background: "#e0f2fe", color: "#0f172a" }}>
                      {d.code}
                    </span>
                    <div className="role-title" style={{ margin: 0 }}>
                      {d.title}
                    </div>
                  </div>
                  <div className="role-desc">{d.desc}</div>
                  <div style={{ marginTop: 10, fontWeight: 700, color: "#2563eb" }}>Continue to login</div>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
