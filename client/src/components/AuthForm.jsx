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
          <h2>
            Plan your time
            <br />
            in the lab.
          </h2>
          <p>
            Check equipment availability, book a session and keep track of your
            reservations.
          </p>
          <ol className="auth-steps">
            <li>
              <strong>Find equipment</strong>
              <span>Browse the catalog and check its current status.</span>
            </li>
            <li>
              <strong>Reserve a session</strong>
              <span>Choose an available one-hour slot.</span>
            </li>
            <li>
              <strong>Keep the lab informed</strong>
              <span>Manage bookings and report equipment faults.</span>
            </li>
          </ol>
        </div>
        <p className="auth-story-footer">
          Booking timezone <strong>Asia/Colombo</strong>
        </p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h1>{register ? 'Create an account' : 'Sign in'}</h1>
          <p className="auth-description">
            {register
              ? 'Register as a student to reserve laboratory equipment.'
              : 'Use your account to access equipment and reservations.'}
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
                      Use 15 to 128 characters. Spaces and Unicode are welcome.
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
