import { useLayoutEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import ProtectedRoute from '../auth/ProtectedRoute.jsx';
import AdminRoute from '../auth/AdminRoute.jsx';
import AppLayout from '../components/AppLayout.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import RegisterPage from '../pages/RegisterPage.jsx';
import EquipmentListPage from '../pages/EquipmentListPage.jsx';
import EquipmentDetailPage from '../pages/EquipmentDetailPage.jsx';
import AdminEquipmentPage from '../pages/admin/AdminEquipmentPage.jsx';
import AdminEquipmentFormPage from '../pages/admin/AdminEquipmentFormPage.jsx';
import ReservationsPage from '../pages/ReservationsPage.jsx';
import FaultReportsPage from '../pages/FaultReportsPage.jsx';
import FaultReportNewPage from '../pages/FaultReportNewPage.jsx';
import FaultReportDetailPage from '../pages/FaultReportDetailPage.jsx';
import AdminDashboardPage from '../pages/admin/AdminDashboardPage.jsx';

export default function AppRoutes() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
  }, [pathname]);
  const { user, loading, error, retry } = useAuth();
  if (loading) return <p role="status">Checking your session…</p>;
  if (error)
    return (
      <section>
        <h1>Unable to connect</h1>
        <p role="alert">{error}</p>
        <button onClick={retry}>Try again</button>
      </section>
    );
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate
            to={
              user
                ? user.role === 'admin'
                  ? '/admin'
                  : '/equipment'
                : '/login'
            }
            replace
          />
        }
      />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/equipment" element={<EquipmentListPage />} />
          <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
          <Route path="/reservations" element={<ReservationsPage />} />
          <Route path="/fault-reports" element={<FaultReportsPage />} />
          <Route path="/fault-reports/new" element={<FaultReportNewPage />} />
          <Route
            path="/fault-reports/:id"
            element={<FaultReportDetailPage />}
          />
          <Route element={<AdminRoute />}>
            <Route
              path="/admin/fault-reports"
              element={<FaultReportsPage admin />}
            />
            <Route
              path="/admin/reservations"
              element={<ReservationsPage admin />}
            />
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/equipment" element={<AdminEquipmentPage />} />
            <Route
              path="/admin/equipment/new"
              element={<AdminEquipmentFormPage />}
            />
            <Route
              path="/admin/equipment/:id/edit"
              element={<AdminEquipmentFormPage />}
            />
          </Route>
        </Route>
      </Route>
      <Route
        path="*"
        element={
          <section>
            <h1>Page not found</h1>
            <Link to="/">Go home</Link>
          </section>
        }
      />
    </Routes>
  );
}
