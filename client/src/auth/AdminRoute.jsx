import { Link, Navigate, Outlet } from 'react-router';
import { useAuth } from './useAuth.js';

export default function AdminRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin')
    return (
      <section>
        <h1>Access denied</h1>
        <p>This area is available to administrators.</p>
        <Link to="/equipment">Go to equipment</Link>
      </section>
    );
  return <Outlet />;
}
