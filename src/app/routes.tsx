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
import SystemShell from "../pages/system/SystemShell";
import OverviewPage from "../pages/system/OverviewPage";
import AnalyticsPage from "../pages/system/AnalyticsPage";
import OperatorsPage from "../pages/system/OperatorsPage";
import PaymentsPage from "../pages/system/PaymentsPage";
import FinancePage from "../pages/system/FinancePage";
import CommsPage from "../pages/system/CommsPage";
import RegistryPage from "../pages/system/RegistryPage";
import MonitoringPage from "../pages/system/MonitoringPage";
import IntelligencePage from "../pages/system/IntelligencePage";
import AlertsPage from "../pages/system/AlertsPage";
import QuarantinePage from "../pages/system/QuarantinePage";
import AdminsPage from "../pages/system/AdminsPage";
import OpsDashboard from "../dashboards/Ops";
import DashHome from "../dashboards/DashHome";
import SaccoApprovals from "../pages/SaccoApprovals";
import WithdrawalPhonesRoute from "../pages/WithdrawalPhonesRoute";
import PendingAccess from "../pages/PendingAccess";
import MatatuLivePayments from "../pages/matatu/MatatuLivePayments";
import AboutPage from "../pages/About";

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
    path: "/about",
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
          "user",
        ]}
      >
        <AboutPage />
      </RequireRole>
    ),
  },
  {
    path: "/matatu/live-payments",
    element: (
      <RequireRole allow={["matatu_staff", "matatu_owner", "super_admin"]}>
        <MatatuLivePayments />
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
        <SystemShell />
      </RequireRole>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
      { path: "monitoring", element: <MonitoringPage /> },
      { path: "intelligence", element: <IntelligencePage /> },
      { path: "alerts", element: <AlertsPage /> },
      { path: "admins", element: <AdminsPage /> },
      { path: "quarantine", element: <QuarantinePage /> },
      { path: "operators", element: <OperatorsPage /> },
      { path: "payments", element: <PaymentsPage /> },
      { path: "finance", element: <FinancePage /> },
      { path: "payouts", element: <FinancePage initialTab="payouts" /> },
      { path: "worker-monitor", element: <FinancePage initialTab="worker_monitor" /> },
      { path: "comms", element: <CommsPage /> },
      { path: "registry", element: <RegistryPage /> },
      { path: "*", element: <Navigate to="/system" replace /> },
    ],
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
