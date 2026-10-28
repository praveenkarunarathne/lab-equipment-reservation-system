import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import Icon from './Icon.jsx';

export default function AuthForm({ register = false }) {
  const { user, login, request } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (user)
    return (
      <Navigate to={user.role === 'admin' ? '/admin' : '/equipment'} replace />
    );

  async function submit(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    try {
      if (register) {
        await request('/auth/register', { method: 'POST', body: fields });
        navigate('/login', { replace: true, state: { registered: true } });
      } else {
        await login(fields);
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const fields = register
    ? ['name', 'email', 'password']
    : ['email', 'password'];
  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="About Labspace">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Icon name="lab" />
          </span>
          <span>
            Labspace<small>Equipment & reservations</small>
          </span>
        </div>
        <div className="auth-story-content">
          <span className="eyebrow">Your laboratory, connected</span>
          <h2>
            Less waiting.
            <br />
            More discovering.
          </h2>
          <p>
            Find the right equipment, reserve your time, and get back to the
            work that matters.
          </p>
          <div className="lab-illustration" aria-hidden="true">
            <div className="lab-orbit orbit-one" />
            <div className="lab-orbit orbit-two" />
            <Icon name="lab" />
            <span className="illustration-label">
              A space for your next discovery
            </span>
          </div>
        </div>
        <p className="auth-story-footer">Lab Equipment Reservation System</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">
            {register ? 'Join your laboratory' : 'Welcome back'}
          </span>
          <h1>{register ? 'Create an account' : 'Sign in'}</h1>
          <p className="auth-description">
            {register
              ? 'Your equipment, bookings, and laboratory updates in one place.'
              : 'Sign in to access your laboratory workspace.'}
          </p>
          {location.state?.registered && !register && (
            <p role="status">Account created. Sign in to continue.</p>
          )}
          {error && <p role="alert">{error.message}</p>}
          <form onSubmit={submit}>
            {fields.map((field) => {
              const messages = error?.fieldErrors?.[`body.${field}`];
              return (
                <div className="form-field" key={field}>
                  <label htmlFor={field}>
                    {field === 'name'
                      ? 'Full name'
                      : field === 'email'
                        ? 'Email'
                        : 'Password'}
                  </label>
                  <input
                    id={field}
                    name={field}
                    type={
                      field === 'password'
                        ? 'password'
                        : field === 'email'
                          ? 'email'
                          : 'text'
                    }
                    autoComplete={
                      field === 'password'
                        ? register
                          ? 'new-password'
                          : 'current-password'
                        : field === 'name'
                          ? 'name'
                          : 'email'
                    }
                    required
                    aria-invalid={Boolean(messages)}
                    aria-describedby={
                      messages
                        ? `${field}-error`
                        : register && field === 'password'
                          ? 'password-help'
                          : undefined
                    }
                  />
                  {register && field === 'password' && (
                    <small id="password-help">
                      Use 15–128 characters. Spaces and Unicode are welcome.
                    </small>
                  )}
                  {messages && (
                    <small id={`${field}-error`} className="field-error">
                      {messages.join(' ')}
                    </small>
                  )}
                </div>
              );
            })}
            <button type="submit" disabled={busy}>
              {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <p>
            {register ? 'Already registered? ' : 'Need an account? '}
            <Link to={register ? '/login' : '/register'}>
              {register ? 'Sign in' : 'Register'}
            </Link>
          </p>
          <p className="auth-help">
            Need access or help? Contact your laboratory administrator.
          </p>
        </div>
      </section>
    </main>
  );
}
