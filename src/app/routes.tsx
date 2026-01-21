import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { RequireRole } from "../auth/RequireRole";

import { Login } from "../auth/Login";
import { RoleSelect } from "../auth/RoleSelect";

import SaccoDashboard from "../dashboards/Sacco";
import MatatuOwnerDashboard from "../dashboards/MatatuOwner";
import MatatuStaffDashboard from "../dashboards/MatatuStaff";
import SaccoStaffDashboard from "../dashboards/SaccoStaff";
import TaxiDashboard from "../dashboards/Taxi";
import BodaDashboard from "../dashboards/Boda";
import SystemDashboard from "../dashboards/System";
import SystemRegistry from "../dashboards/SystemRegistry";
import OpsDashboard from "../dashboards/Ops";
import DashHome from "../dashboards/DashHome";
import SaccoApprovals from "../pages/SaccoApprovals";
import WithdrawalPhonesRoute from "../pages/WithdrawalPhonesRoute";
import PendingAccess from "../pages/PendingAccess";
import LivePaymentsPage from "../pages/sacco/LivePayments";

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/role" replace /> },
  { path: "/login", element: <Login /> },
  { path: "/role", element: <RoleSelect /> },
  { path: "/app", element: <Navigate to="/dash" replace /> },
  { path: "/app/system", element: <Navigate to="/system" replace /> },
  { path: "/app/sacco-admin", element: <Navigate to="/sacco" replace /> },
  { path: "/app/sacco-staff", element: <Navigate to="/sacco/staff" replace /> },
  { path: "/app/matatu-owner", element: <Navigate to="/matatu/owner" replace /> },
  { path: "/app/matatu-staff", element: <Navigate to="/matatu/staff" replace /> },
  {
    path: "/app/pending",
    element: (
      <RequireRole
        allow={[
          "user",
          "super_admin",
          "system_admin",
          "sacco_admin",
          "sacco_staff",
          "matatu_owner",
          "matatu_staff",
          "taxi",
          "boda",
        ]}
      >
        <PendingAccess />
      </RequireRole>
    ),
  },
  {
    path: "/dash",
    element: (
      <RequireRole
        allow={[
          "super_admin",
          "system_admin",
          "sacco_admin",
          "sacco_staff",
          "matatu_owner",
          "matatu_staff",
          "taxi",
          "boda",
        ]}
      >
        <DashHome />
      </RequireRole>
    ),
  },

  {
    path: "/sacco",
    element: (
      <RequireRole allow={["sacco_admin", "super_admin", "system_admin"]}>
        <SaccoDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/sacco/staff",
    element: (
      <RequireRole allow={["sacco_staff", "sacco_admin", "super_admin"]}>
        <SaccoStaffDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/sacco/live-payments",
    element: (
      <RequireRole allow={["sacco_staff", "sacco_admin", "super_admin", "system_admin"]}>
        <LivePaymentsPage />
      </RequireRole>
    ),
  },
  {
    path: "/matatu/owner",
    element: (
      <RequireRole allow={["matatu_owner", "super_admin"]}>
        <MatatuOwnerDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/matatu/staff",
    element: (
      <RequireRole allow={["matatu_staff", "super_admin"]}>
        <MatatuStaffDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/taxi",
    element: (
      <RequireRole allow={["taxi", "super_admin"]}>
        <TaxiDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/boda",
    element: (
      <RequireRole allow={["boda", "super_admin"]}>
        <BodaDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/system",
    element: (
      <RequireRole allow={["super_admin", "system_admin"]}>
        <SystemDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/system/registry",
    element: (
      <RequireRole allow={["super_admin", "system_admin"]}>
        <SystemRegistry />
      </RequireRole>
    ),
  },
  {
    path: "/system/payouts",
    element: (
      <RequireRole allow={["super_admin", "system_admin"]}>
        <SystemDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/sacco/approvals",
    element: (
      <RequireRole allow={["super_admin", "system_admin", "sacco_admin"]}>
        <SaccoApprovals />
      </RequireRole>
    ),
  },
  {
    path: "/system/worker-monitor",
    element: (
      <RequireRole allow={["super_admin", "system_admin"]}>
        <SystemDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/ops",
    element: (
      <RequireRole allow={["super_admin", "system_admin"]}>
        <OpsDashboard />
      </RequireRole>
    ),
  },
  {
    path: "/matatu/withdrawal-phones/:walletId",
    element: (
      <RequireRole allow={["super_admin", "matatu_owner"]}>
        <WithdrawalPhonesRoute />
      </RequireRole>
    ),
  },
];
