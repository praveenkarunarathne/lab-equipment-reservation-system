import { Navigate, Outlet } from 'react-router';
import { useAuth } from './useAuth.js';

export default function ProtectedRoute() {
  const { user } = useAuth();
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
