import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { useAuth } from '../auth/useAuth.js';
import AppRoutes from '../routes/AppRoutes.jsx';
import { apiRequest } from '../api/apiClient.js';

const password = '  exact password 🔬  ';
const student = {
  id: '0123456789abcdef01234567',
  name: 'Test Student',
  email: 'student@example.com',
  role: 'student',
};
let state, fetchMock;

function failure(status, code, message, fieldErrors) {
  return Response.json(
    { error: { code, message, fieldErrors, requestId: 'test-request' } },
    { status },
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  state = {
    user: null,
    token: 'pre-auth-token',
    accounts: new Map([
      [student.email, { user: student, password }],
      [
        'admin@example.com',
        {
          user: { ...student, email: 'admin@example.com', role: 'admin' },
          password,
        },
      ],
    ]),
  };
  fetchMock = vi.fn(async (url, options = {}) => {
    const path = url.replace('/api/v1', '');
    if (path === '/auth/me')
      return state.user
        ? Response.json({ data: { user: state.user } })
        : failure(401, 'AUTH_REQUIRED', 'Please sign in.');
    if (path === '/auth/csrf')
      return Response.json({ data: { csrfToken: state.token } });
    if (path === '/admin/dashboard')
      return Response.json({
        data: {
          equipment: {
            total: 0,
            byStatus: { available: 0, maintenance: 0, unavailable: 0 },
          },
          upcomingReservationCount: 0,
          openFaultReportCount: 0,
          topEquipment: [],
        },
      });
    if (path.startsWith('/equipment?'))
      return Response.json({
        data: [],
        pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
      });
    if (path === '/probe') {
      state.user = null;
      return failure(401, 'AUTH_REQUIRED', 'Please sign in.');
    }
    if (options.headers?.['X-CSRF-Token'] !== state.token)
      return failure(403, 'CSRF_INVALID', 'Invalid token.');
    if (path === '/auth/register') {
      const body = JSON.parse(options.body);
      if ([...body.password].length < 15)
        return failure(400, 'VALIDATION_ERROR', 'Request validation failed.', {
          'body.password': [
            'Password must contain 15 to 128 Unicode characters.',
          ],
        });
      state.accounts.set(body.email, {
        user: { ...student, name: body.name, email: body.email },
        password: body.password,
      });
      return Response.json(
        { data: { user: { ...student, ...body, password: undefined } } },
        { status: 201 },
      );
    }
    if (path === '/auth/login') {
      const body = JSON.parse(options.body);
      const account = state.accounts.get(body.email);
      if (!account || account.password !== body.password)
        return failure(
          401,
          'INVALID_CREDENTIALS',
          'Invalid email or password.',
        );
      state.user = account.user;
      state.token = 'post-login-token';
      return Response.json({
        data: { user: state.user, csrfToken: state.token },
      });
    }
    if (path === '/auth/logout') {
      state.user = null;
      state.token = 'new-pre-auth-token';
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected test request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

function SessionProbe() {
  const { request } = useAuth();
  return (
    <button onClick={() => request('/probe').catch(() => {})}>
      Check session
    </button>
  );
}

function renderApp(path = '/', probe = false) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        {probe && <SessionProbe />}
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function fillLogin(user, email = student.email, secret = password) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), secret);
}

test('registration preserves the password and returns to login without signing in', async () => {
  const user = userEvent.setup();
  renderApp('/register');
  await screen.findByRole('heading', { name: 'Create an account' });
  await user.type(screen.getByLabelText('Full name'), 'New Student');
  await fillLogin(user, 'new@example.com');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(screen.getByRole('status')).toHaveTextContent('Account created.');
  expect(state.user).toBeNull();
  const [, options] = fetchMock.mock.calls.find(([url]) =>
    url.endsWith('/auth/register'),
  );
  expect(JSON.parse(options.body).password).toBe(password);
  expect(options.headers['X-CSRF-Token']).toBe('pre-auth-token');
  expect(options.credentials).toBe('same-origin');
});

test.each([200, 401, 503])(
  'unreadable API responses retain HTTP status %s and show a safe message',
  async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('not JSON', { status }));
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({
      status,
      message: 'The server returned an unreadable response. Please try again.',
    });
  },
);

test('login uses the bootstrap token and logout uses the rotated token', async () => {
  const user = userEvent.setup();
  renderApp();
  await screen.findByRole('heading', { name: 'Sign in' });
  await fillLogin(user);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Equipment' });
  expect(
    screen.queryByRole('link', { name: 'Administration' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  const [, loginOptions] = fetchMock.mock.calls.find(([url]) =>
    url.endsWith('/auth/login'),
  );
  const [, logoutOptions] = fetchMock.mock.calls.find(([url]) =>
    url.endsWith('/auth/logout'),
  );
  expect(loginOptions.headers['X-CSRF-Token']).toBe('pre-auth-token');
  expect(logoutOptions.headers['X-CSRF-Token']).toBe('post-login-token');
  expect(logoutOptions.body).toBeUndefined();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

test('existing sessions restore after reload and administrators land on their own page', async () => {
  state.user = { ...student, role: 'admin' };
  renderApp('/');
  await screen.findByRole('heading', { name: 'Administration' });
  expect(
    screen.getByRole('link', { name: 'Administration' }),
  ).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/auth/me'))).toBe(
    true,
  );
});

test('an administrator can sign in through the public form', async () => {
  const user = userEvent.setup();
  renderApp('/login');
  await screen.findByRole('heading', { name: 'Sign in' });
  await fillLogin(user, 'admin@example.com');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Administration' });
});

test('protected routes redirect anonymous users and block student access to admin pages', async () => {
  const first = renderApp('/admin');
  await screen.findByRole('heading', { name: 'Sign in' });
  first.unmount();
  state.user = student;
  renderApp('/admin');
  await screen.findByRole('heading', { name: 'Access denied' });
  expect(
    screen.queryByRole('link', { name: 'Administration' }),
  ).not.toBeInTheDocument();
});

test('field errors are shown beside their inputs and credentials failures remain generic', async () => {
  const user = userEvent.setup();
  renderApp('/register');
  await screen.findByRole('heading', { name: 'Create an account' });
  await user.type(screen.getByLabelText('Full name'), 'Test Student');
  await fillLogin(user, student.email, 'short');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(
    await screen.findByText(
      'Password must contain 15 to 128 Unicode characters.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await user.click(screen.getByRole('link', { name: 'Sign in' }));
  await fillLogin(user, student.email, 'wrong password for this account');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Invalid email or password.',
  );
});

test('submit stays disabled until an in-flight login finishes', async () => {
  const user = userEvent.setup();
  renderApp('/login');
  await screen.findByRole('heading', { name: 'Sign in' });
  await fillLogin(user);
  let finish;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
  finish(failure(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

test('bootstrap failures offer a retry instead of treating the user as signed out', async () => {
  fetchMock.mockRejectedValueOnce(new Error('Connection unavailable.'));
  const user = userEvent.setup();
  renderApp('/equipment');
  await screen.findByRole('heading', { name: 'Unable to connect' });
  expect(
    screen.queryByRole('heading', { name: 'Sign in' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('heading', { name: 'Sign in' });
});

test('an authoritative 401 clears authenticated state and returns to sign in', async () => {
  const user = userEvent.setup();
  state.user = student;
  renderApp('/equipment', true);
  await screen.findByRole('heading', { name: 'Equipment' });
  await user.click(screen.getByRole('button', { name: 'Check session' }));
  await screen.findByRole('heading', { name: 'Sign in' });
});

test('CSRF failure does not replay a mutation and fetches a fresh token on the next submission', async () => {
  const user = userEvent.setup();
  renderApp('/register');
  await screen.findByRole('heading', { name: 'Create an account' });
  await user.type(screen.getByLabelText('Full name'), 'Test Student');
  await fillLogin(user);
  state.token = 'changed-in-another-tab';
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your session changed. Please try again.',
  );
  expect(
    fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/register')),
  ).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/register')),
    ).toHaveLength(2),
  );
});
