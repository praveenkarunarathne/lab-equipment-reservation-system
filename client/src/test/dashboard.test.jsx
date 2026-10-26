import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { AuthContext } from '../auth/authContext.js';
import AppRoutes from '../routes/AppRoutes.jsx';

const data = {
  equipment: {
    total: 9,
    byStatus: { available: 6, maintenance: 2, unavailable: 1 },
  },
  upcomingReservationCount: 12,
  openFaultReportCount: 4,
  topEquipment: [
    {
      equipmentId: '0123456789abcdef01234567',
      assetCode: 'SCOPE-01',
      name: 'Microscope',
      reservationCount: 7,
    },
    {
      equipmentId: 'abcdef0123456789abcdef01',
      assetCode: 'METER-01',
      name: 'Multimeter',
      reservationCount: 3,
    },
  ],
};
const empty = {
  equipment: {
    total: 0,
    byStatus: { available: 0, maintenance: 0, unavailable: 0 },
  },
  upcomingReservationCount: 0,
  openFaultReportCount: 0,
  topEquipment: [],
};
function renderPage(request, role = 'admin', path = '/admin') {
  return render(
    <AuthContext.Provider
      value={{
        user: { name: 'Test User', role },
        request,
        loading: false,
        error: null,
        logout: vi.fn(),
        retry: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}
function metric(label) {
  return screen.getByRole('link', { name: label, exact: true }).closest('div');
}

test('dashboard renders equipment totals, reservation and fault metrics, and ranked equipment links', async () => {
  const request = vi.fn().mockResolvedValue(data);
  renderPage(request);
  await screen.findByRole('table');
  for (const [label, count] of [
    ['Current equipment', 9],
    ['Available', 6],
    ['Maintenance', 2],
    ['Unavailable', 1],
    ['Upcoming reservations', 12],
    ['Open fault reports', 4],
  ]) {
    expect(
      within(metric(label)).getByText(String(count), { exact: true }),
    ).toBeInTheDocument();
  }
  const rows = within(screen.getByRole('table')).getAllByRole('row');
  expect(rows).toHaveLength(3);
  expect(rows[1]).toHaveTextContent('SCOPE-01Microscope7');
  expect(rows[2]).toHaveTextContent('METER-01Multimeter3');
  expect(
    screen.getByRole('link', { name: 'Microscope', exact: true }),
  ).toHaveAttribute('href', `/equipment/${data.topEquipment[0].equipmentId}`);
  expect(screen.getByText(/physical use is not tracked/)).toBeInTheDocument();
  expect(request.mock.calls[0][0]).toBe('/admin/dashboard');
});

test('metric cards link to the matching management filters', async () => {
  renderPage(vi.fn().mockResolvedValue(data));
  await screen.findByRole('table');
  for (const [label, path] of [
    ['Current equipment', '/admin/equipment'],
    ['Available', '/admin/equipment?status=available'],
    ['Maintenance', '/admin/equipment?status=maintenance'],
    ['Unavailable', '/admin/equipment?status=unavailable'],
    ['Upcoming reservations', '/admin/reservations?view=upcoming'],
    ['Open fault reports', '/admin/fault-reports?status=open'],
  ])
    expect(
      screen.getByRole('link', { name: label, exact: true }),
    ).toHaveAttribute('href', path);
});

test('open-fault metric opens management with the open filter', async () => {
  const user = userEvent.setup();
  const request = vi.fn(async (path) =>
    path === '/admin/dashboard'
      ? data
      : {
          data: [],
          pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
        },
  );
  renderPage(request);
  await user.click(
    await screen.findByRole('link', {
      name: 'Open fault reports',
      exact: true,
    }),
  );
  await screen.findByRole('heading', { name: 'Manage fault reports' });
  await screen.findByText('No fault reports match these filters.');
  expect(screen.getByLabelText('Status')).toHaveValue('open');
  expect(request.mock.calls.at(-1)[0]).toBe(
    '/fault-reports?page=1&limit=12&status=open',
  );
});

test('empty dashboard shows all zero metrics and a useful empty usage state', async () => {
  renderPage(vi.fn().mockResolvedValue(empty));
  await screen.findByText(
    'No reservation starts in the previous 30 days for current equipment.',
  );
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  for (const label of [
    'Current equipment',
    'Available',
    'Maintenance',
    'Unavailable',
    'Upcoming reservations',
    'Open fault reports',
  ])
    expect(
      within(metric(label)).getByText('0', { exact: true }),
    ).toBeInTheDocument();
});

test('dashboard loading and errors avoid showing misleading zero metrics, then retry recovers', async () => {
  const user = userEvent.setup();
  let reject;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce(data);
  renderPage(request);
  expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Refresh dashboard' }),
  ).toBeDisabled();
  expect(
    screen.queryByRole('link', { name: 'Current equipment' }),
  ).not.toBeInTheDocument();
  await act(async () => reject(new Error('Dashboard unavailable.')));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Dashboard unavailable.',
  );
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('table');
  expect(request).toHaveBeenCalledTimes(2);
});

test('explicit refresh recalculates displayed metrics and removes stale usage rows', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValueOnce(data)
    .mockResolvedValueOnce(empty);
  renderPage(request);
  await screen.findByRole('table');
  await user.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
  await screen.findByText(
    'No reservation starts in the previous 30 days for current equipment.',
  );
  expect(
    within(metric('Open fault reports')).getByText('0'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Microscope', exact: true }),
  ).not.toBeInTheDocument();
  expect(request.mock.calls[1][0]).toBe('/admin/dashboard');
});

test('students cannot open dashboard or see admin navigation', async () => {
  const request = vi.fn();
  renderPage(request, 'student');
  await screen.findByRole('heading', { name: 'Access denied' });
  expect(request).not.toHaveBeenCalled();
  for (const label of [
    'Administration',
    'Manage equipment',
    'Manage reservations',
    'Manage fault reports',
  ])
    expect(
      screen.queryByRole('link', { name: label, exact: true }),
    ).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'My reservations' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'My fault reports' }),
  ).toBeInTheDocument();
});

test('administrators land on the dashboard with navigation to every management page', async () => {
  const request = vi.fn().mockResolvedValue(empty);
  renderPage(request, 'admin', '/');
  await screen.findByText(
    'No reservation starts in the previous 30 days for current equipment.',
  );
  for (const [label, path] of [
    ['Administration', '/admin'],
    ['Manage equipment', '/admin/equipment'],
    ['Manage reservations', '/admin/reservations'],
    ['Manage fault reports', '/admin/fault-reports'],
  ])
    expect(
      screen.getByRole('link', { name: label, exact: true }),
    ).toHaveAttribute('href', path);
  expect(request.mock.calls[0][0]).toBe('/admin/dashboard');
});
