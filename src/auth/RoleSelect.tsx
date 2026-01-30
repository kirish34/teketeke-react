import { Link, useLocation } from "react-router-dom";

type DashCard = {
  code: string;
  title: string;
  desc: string;
  next: string;
};

const dashboards: DashCard[] = [
  { code: "SSA", title: "Super System Admin", desc: "Full platform control, registry, audits and operator oversight.", next: "/system" },
  { code: "SA", title: "System Admin", desc: "Platform settings, alerts and audit logs.", next: "/system" },
  { code: "SC", title: "SACCO Admin", desc: "Manage members, vehicles, transactions, loans and reports.", next: "/sacco" },
  { code: "SS", title: "SACCO Staff", desc: "Cash desk: record fees, savings and loan repayments.", next: "/sacco/staff" },
  { code: "MO", title: "Matatu Owner", desc: "View vehicle details, staff and daily transactions.", next: "/matatu/owner" },
  { code: "MS", title: "Matatu Staff", desc: "Trip operations and manual cash entries.", next: "/matatu/staff" },
  { code: "TX", title: "Taxi", desc: "Daily cash, expenses and net position.", next: "/taxi" },
  { code: "BB", title: "BodaBoda", desc: "Collect cash, track expenses and view totals.", next: "/boda" },
];

export function RoleSelect() {
  const location = useLocation();
  const incomingNext = new URLSearchParams(location.search).get("next") || "";

  return (
    <div className="role-shell">
      <div className="role-hero">
        <div className="role-hero-kicker">TekeTeke Go Console</div>
        <div className="role-hero-title">Role Select</div>
        <div className="role-hero-sub">Choose how you're using TekeTeke today.</div>
      </div>

      <div className="role-list-card">
        <div className="role-list-title">Available roles</div>
        <div className="role-pill-stack">
          {dashboards.map((d) => {
            const params = new URLSearchParams();
            params.set("next", d.next);
            if (incomingNext) params.set("from", incomingNext);
            return (
              <Link key={d.next} to={`/login?${params.toString()}`} className="role-pill">
                {d.title}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
