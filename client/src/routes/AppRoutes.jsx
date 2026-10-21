import { Link, Navigate, Route, Routes } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import ProtectedRoute from '../auth/ProtectedRoute.jsx';
import AdminRoute from '../auth/AdminRoute.jsx';
import AppLayout from '../components/AppLayout.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import RegisterPage from '../pages/RegisterPage.jsx';

export default function AppRoutes() {
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
          <Route
            path="/equipment"
            element={
              <section>
                <h1>Equipment</h1>
                <p>Welcome, {user?.name}.</p>
              </section>
            }
          />
          <Route element={<AdminRoute />}>
            <Route
              path="/admin"
              element={
                <section>
                  <h1>Administration</h1>
                  <p>Welcome, {user?.name}.</p>
                </section>
              }
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
