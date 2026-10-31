import { useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import Icon from './Icon.jsx';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);
  const sidebar = useRef(null);
  useGSAP(
    () => {
      if (!menuOpen || !window.matchMedia) return;
      const media = gsap.matchMedia();
      media.add(
        '(max-width: 760px) and (prefers-reduced-motion: no-preference)',
        () => {
          gsap.fromTo(
            sidebar.current,
            { x: -16, opacity: 0.8 },
            {
              x: 0,
              opacity: 1,
              duration: 0.18,
              ease: 'power2.out',
              clearProps: 'transform,opacity',
            },
          );
        },
      );
      return () => media.revert();
    },
    { scope: sidebar, dependencies: [menuOpen], revertOnUpdate: true },
  );
  useLayoutEffect(() => {
    if (!menuOpen) return;
    sidebar.current?.querySelector('a')?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        menuButton.current?.focus();
      }
      if (event.key !== 'Tab') return;
      const items = sidebar.current.querySelectorAll(
        'a[href], button:not(:disabled)',
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!sidebar.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const resize = () => {
      if (window.innerWidth > 760) {
        setMenuOpen(false);
        document.getElementById('main-content')?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('resize', resize);
    document.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', keydown);
    };
  }, [menuOpen]);
  const admin = user.role === 'admin';
  const links = [
    ...(admin
      ? [{ to: '/admin', label: 'Administration', icon: 'grid', end: true }]
      : []),
    { to: '/equipment', label: 'Equipment', icon: 'equipment' },
    ...(admin
      ? [{ to: '/admin/equipment', label: 'Manage equipment', icon: 'tool' }]
      : []),
    {
      to: admin ? '/admin/reservations' : '/reservations',
      label: admin ? 'Manage reservations' : 'My reservations',
      icon: 'calendar',
    },
    {
      to: admin ? '/admin/fault-reports' : '/fault-reports',
      label: admin ? 'Manage fault reports' : 'My fault reports',
      icon: 'report',
    },
  ];
  const current =
    (pathname.startsWith('/fault-reports')
      ? admin
        ? 'Manage fault reports'
        : 'My fault reports'
      : links.findLast((link) =>
          link.end ? pathname === link.to : pathname.startsWith(link.to),
        )?.label) ?? 'Workspace';
  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus();
  }
  function navigate() {
    setMenuOpen(false);
    if (menuOpen)
      document.getElementById('main-content')?.focus({ preventScroll: true });
  }
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
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menuOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={closeMenu}
        />
      )}
      <aside
        ref={sidebar}
        id="app-sidebar"
        className={`app-sidebar js ${menuOpen ? 'is-open' : ''}`}
      >
        <Link to="/" className="brand-lockup" onClick={navigate}>
          <span className="brand-mark">
            <Icon name="lab" />
          </span>
          <span>
            Labspace<small>Equipment & reservations</small>
          </span>
        </Link>
        <p className="nav-caption">{admin ? 'Management' : 'Laboratory'}</p>
        <nav aria-label="Main navigation" className="side-nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `nav-link ${isActive ? 'is-active' : ''}`
              }
              onClick={navigate}
            >
              <Icon name={link.icon} />
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-account">
          <span className="avatar">{[...user.name][0].toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <span>{admin ? 'Administrator' : 'Student account'}</span>
          </div>
        </div>
        <button className="signout-button" onClick={signOut} disabled={busy}>
          <Icon name="logout" />
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </aside>
      <div className="workspace">
        <header className="workspace-topbar">
          <div className="topbar-location">
            <button
              ref={menuButton}
              className="menu-toggle"
              aria-label={menuOpen ? 'Close menu' : 'Open navigation'}
              aria-expanded={menuOpen}
              aria-controls="app-sidebar"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Icon name="menu" />
            </button>
            <span>Labspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{current}</strong>
          </div>
          <span className="workspace-role">
            {admin ? 'Administrator' : 'Student'}
          </span>
        </header>
        <main id="main-content" className="workspace-content" tabIndex={-1}>
          {error && <p role="alert">{error}</p>}
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>Lab Equipment Reservation System</span>
          <span>Booking timezone: Asia/Colombo</span>
        </footer>
      </div>
    </div>
  );
}
