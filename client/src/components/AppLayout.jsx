import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/useAuth.js';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await logout();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header>
        <nav aria-label="Main navigation">
          <Link to="/equipment">Equipment</Link>
          {user.role === 'admin' && <Link to="/admin">Administration</Link>}
          <span>{user.name}</span>
          <button onClick={signOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </nav>
      </header>
      {error && <p role="alert">{error}</p>}
      <Outlet />
    </>
  );
}
