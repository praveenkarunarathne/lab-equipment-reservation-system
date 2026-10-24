import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeAll, expect, test, vi } from 'vitest';
import { AuthContext } from '../auth/authContext.js';
import AppRoutes from '../routes/AppRoutes.jsx';

const item = {
  id: '0123456789abcdef01234567',
  assetCode: 'SCOPE-01',
  name: 'Microscope',
  category: 'Optics',
  location: 'Lab A',
  description: '',
  status: 'available',
  statusReason: null,
};
const slot = {
  startAt: '2026-10-26T03:00:00.000Z',
  endAt: '2026-10-26T04:00:00.000Z',
  label: 'Mon, 26 Oct 2026 08:30–09:30',
};
const secondSlot = {
  startAt: '2026-10-26T04:00:00.000Z',
  endAt: '2026-10-26T05:00:00.000Z',
  label: 'Mon, 26 Oct 2026 09:30–10:30',
};
const availability = {
  equipmentId: item.id,
  bookable: true,
  timezone: 'Asia/Colombo',
  slots: [slot],
};
const reservation = {
  id: 'abcdef0123456789abcdef01',
  status: 'active',
  phase: 'upcoming',
  startAt: slot.startAt,
  endAt: slot.endAt,
  cancelledAt: null,
  cancellationReason: null,
  equipment: { ...item, archived: false },
};
function list(records = [reservation], pagination = {}) {
  return {
    data: records,
    pagination: {
      page: 1,
      limit: 12,
      total: records.length,
      totalPages: records.length ? 1 : 0,
      ...pagination,
    },
  };
}
function renderPage(path, request, role = 'student') {
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
function bookingRequest(extra) {
  return vi.fn(async (path, options) => {
    if (path === `/equipment/${item.id}`) return item;
    if (path === `/equipment/${item.id}/availability`) return availability;
    return extra?.(path, options);
  });
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

test('booking submits exactly the selected server instant, refreshes availability, and opens own reservations', async () => {
  const user = userEvent.setup();
  let booked = false;
  const request = vi.fn(async (path, options) => {
    if (path === `/equipment/${item.id}`) return item;
    if (path.endsWith('/availability'))
      return { ...availability, slots: booked ? [secondSlot] : [slot] };
    if (path === '/reservations') {
      expect(options).toEqual({
        method: 'POST',
        body: { equipmentId: item.id, startAt: slot.startAt },
      });
      booked = true;
      return reservation;
    }
    if (path.startsWith('/reservations/mine?')) return list();
    throw new Error(`Unexpected request: ${path}`);
  });
  renderPage(`/equipment/${item.id}`, request);
  const select = await screen.findByLabelText('Available slot');
  expect(within(select).getAllByRole('option')).toHaveLength(2);
  expect(screen.queryByLabelText(/date/i)).not.toBeInTheDocument();
  await user.selectOptions(select, slot.startAt);
  await user.click(screen.getByRole('button', { name: 'Book slot' }));
  await screen.findByText(/Reservation confirmed/);
  expect(
    await screen.findByRole('option', { name: secondSlot.label }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Available slot')).toHaveValue('');
  expect(
    screen.queryByRole('option', { name: slot.label }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'View my reservations' }));
  await screen.findByRole('heading', { name: 'My reservations' });
  expect(
    await screen.findByRole('button', {
      name: 'Cancel reservation for Microscope',
    }),
  ).toBeInTheDocument();
});

test('a booking conflict refreshes advisory slots and requires an explicit new selection', async () => {
  const user = userEvent.setup();
  let conflicted = false;
  const request = vi.fn(async (path) => {
    if (path === `/equipment/${item.id}`) return item;
    if (path.endsWith('/availability'))
      return { ...availability, slots: conflicted ? [secondSlot] : [slot] };
    conflicted = true;
    throw Object.assign(new Error('This slot is already booked.'), {
      status: 409,
      code: 'RESERVATION_CONFLICT',
    });
  });
  renderPage(`/equipment/${item.id}`, request);
  await user.selectOptions(
    await screen.findByLabelText('Available slot'),
    slot.startAt,
  );
  await user.click(screen.getByRole('button', { name: 'Book slot' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This slot is already booked.',
  );
  await screen.findByRole('option', { name: secondSlot.label });
  expect(screen.getByLabelText('Available slot')).toHaveValue('');
  expect(
    request.mock.calls.filter(([path]) => path === '/reservations'),
  ).toHaveLength(1);
});

test('booking shows server field validation and refreshes elapsed slots', async () => {
  const user = userEvent.setup();
  const request = bookingRequest(() => {
    throw Object.assign(new Error('Request validation failed.'), {
      fieldErrors: { 'body.startAt': ['Choose a future slot.'] },
    });
  });
  renderPage(`/equipment/${item.id}`, request);
  await user.selectOptions(
    await screen.findByLabelText('Available slot'),
    slot.startAt,
  );
  await user.click(screen.getByRole('button', { name: 'Book slot' }));
  expect(await screen.findByText('Choose a future slot.')).toBeInTheDocument();
  expect(screen.getByLabelText('Available slot')).toHaveAttribute(
    'aria-describedby',
    'slot-error',
  );
});

test('booking disables duplicate submission and refresh while a request is pending', async () => {
  const user = userEvent.setup();
  let resolve;
  const request = bookingRequest(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  renderPage(`/equipment/${item.id}`, request);
  await user.selectOptions(
    await screen.findByLabelText('Available slot'),
    slot.startAt,
  );
  await user.click(screen.getByRole('button', { name: 'Book slot' }));
  expect(screen.getByRole('button', { name: 'Booking…' })).toBeDisabled();
  expect(screen.getByLabelText('Available slot')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Refresh availability' }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Booking…' }));
  expect(
    request.mock.calls.filter(([path]) => path === '/reservations'),
  ).toHaveLength(1);
  await act(async () => resolve(reservation));
});

test.each([
  [
    { ...availability, bookable: false, slots: [] },
    'This equipment is currently unavailable for booking.',
  ],
  [
    { ...availability, slots: [] },
    'No slots are available in the next 14 days.',
  ],
])(
  'unavailable or fully booked equipment cannot be booked',
  async (data, message) => {
    const request = vi.fn(async (path) =>
      path.endsWith('/availability') ? data : item,
    );
    renderPage(`/equipment/${item.id}`, request);
    await screen.findByText(message);
    expect(
      screen.queryByRole('button', { name: 'Book slot' }),
    ).not.toBeInTheDocument();
  },
);

test('availability failures support retry and admins have no booking controls', async () => {
  const user = userEvent.setup();
  let failed = false;
  const request = vi.fn(async (path) => {
    if (!path.endsWith('/availability')) return item;
    if (!failed) {
      failed = true;
      throw new Error('Availability unavailable.');
    }
    return availability;
  });
  const first = renderPage(`/equipment/${item.id}`, request);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Availability unavailable.',
  );
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByLabelText('Available slot');
  first.unmount();
  request.mockClear();
  renderPage(`/equipment/${item.id}`, request, 'admin');
  await screen.findByRole('heading', { name: 'Microscope' });
  expect(
    screen.queryByRole('heading', { name: 'Reserve a slot' }),
  ).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
});

test('student view filters and pagination retain the selected view and reset page on a new filter', async () => {
  const user = userEvent.setup();
  const request = vi.fn(async (path) =>
    list([reservation], {
      page: Number(new URL(path, 'http://test').searchParams.get('page')),
      total: 25,
      totalPages: 3,
    }),
  );
  renderPage('/reservations?view=history&page=2', request);
  await screen.findByText('25 reservations found.');
  expect(request.mock.calls[0][0]).toBe(
    '/reservations/mine?view=history&page=2&limit=12',
  );
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Page 3 of 3');
  expect(request.mock.calls.at(-1)[0]).toContain('view=history&page=3');
  await user.selectOptions(screen.getByLabelText('View'), 'all');
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  await screen.findByText('Page 1 of 3');
  expect(request.mock.calls.at(-1)[0]).toContain('view=all&page=1');
  expect(screen.queryByText('Only this student')).not.toBeInTheDocument();
});

test('history shows archived equipment without a broken link and distinguishes phases and cancellation reasons', async () => {
  const records = [
    {
      ...reservation,
      id: '1',
      status: 'cancelled',
      cancellationReason: 'equipment_archived',
      cancelledAt: '2026-10-25T03:00:00.000Z',
      equipment: { ...reservation.equipment, archived: true },
    },
    { ...reservation, id: '2', phase: 'inProgress' },
    { ...reservation, id: '3', phase: 'past' },
  ];
  renderPage(
    '/reservations?view=history',
    vi.fn().mockResolvedValue(list(records)),
  );
  expect(await screen.findByText('Microscope (Archived)')).toBeInTheDocument();
  expect(screen.getByText('Equipment archived')).toBeInTheDocument();
  expect(screen.getByText('In progress')).toBeInTheDocument();
  expect(screen.getByText('Past')).toBeInTheDocument();
  const row = screen.getByText('Microscope (Archived)').closest('tr');
  expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Cancel reservation for/ }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText('26 Oct 2026, 08:30').length).toBeGreaterThan(0);
});

test('confirmed cancellation sends no audit fields, refetches the current view, and shows success', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValueOnce(list())
    .mockResolvedValueOnce({ ...reservation, status: 'cancelled' })
    .mockResolvedValueOnce(list([]));
  renderPage('/reservations', request);
  await user.click(
    await screen.findByRole('button', {
      name: 'Cancel reservation for Microscope',
    }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Cancel reservation?',
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByText(/08:30/)).toHaveTextContent('Asia/Colombo');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm cancellation' }),
  );
  await screen.findByText('Reservation cancelled.');
  await screen.findByText('No reservations match this view.');
  expect(request.mock.calls[1]).toEqual([
    `/reservations/${reservation.id}/cancel`,
    { method: 'PATCH' },
  ]);
  expect(request.mock.calls[2][0]).toBe(request.mock.calls[0][0]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('cancellation errors stay visible, refresh stale phase, and prevent dismissal or repeats while pending', async () => {
  const user = userEvent.setup();
  let reject;
  const request = vi
    .fn()
    .mockResolvedValueOnce(list())
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce(list([{ ...reservation, phase: 'inProgress' }]));
  renderPage('/reservations?view=all', request);
  await user.click(
    await screen.findByRole('button', {
      name: 'Cancel reservation for Microscope',
    }),
  );
  const dialog = await screen.findByRole('dialog');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm cancellation' }),
  );
  expect(
    within(dialog).getByRole('button', { name: 'Saving…' }),
  ).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(dialog).toBeInTheDocument();
  await act(async () =>
    reject(
      Object.assign(new Error('The reservation has already started.'), {
        status: 409,
      }),
    ),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'already started',
  );
  await screen.findByText('In progress');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Cancel reservation for Microscope' }),
  ).not.toBeInTheDocument();
});

test('admin list shows student summaries and filters by equipment or student without exposing ID inputs', async () => {
  const user = userEvent.setup();
  const student = {
    id: '123456789abcdef012345678',
    name: 'Student One',
    email: 'student@example.com',
  };
  const request = vi
    .fn()
    .mockResolvedValue(list([{ ...reservation, student }]));
  renderPage('/admin/reservations', request, 'admin');
  await screen.findByText(/Student One/);
  expect(screen.getByText(/student@example.com/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Only this student' }));
  await screen.findByText(/Student One/);
  expect(request.mock.calls.at(-1)[0]).toContain(`studentId=${student.id}`);
  await user.click(screen.getByRole('button', { name: 'Only this equipment' }));
  await screen.findByText(/Student One/);
  expect(request.mock.calls.at(-1)[0]).toContain(`equipmentId=${item.id}`);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await screen.findByText(/Student One/);
  expect(request.mock.calls.at(-1)[0]).toBe(
    '/reservations?view=upcoming&page=1&limit=12',
  );
});

test('students cannot open admin management and admin own-route redirects to all reservations', async () => {
  const request = vi.fn().mockResolvedValue(list([]));
  const first = renderPage('/admin/reservations', request);
  await screen.findByRole('heading', { name: 'Access denied' });
  expect(request).not.toHaveBeenCalled();
  first.unmount();
  renderPage('/reservations', request, 'admin');
  await screen.findByRole('heading', { name: 'Manage reservations' });
  await screen.findByText('No reservations match this view.');
  expect(request.mock.calls[0][0]).toBe(
    '/reservations?view=upcoming&page=1&limit=12',
  );
});

test('reservation list has loading, recoverable error, and empty states', async () => {
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
    .mockResolvedValueOnce(list([]));
  renderPage('/reservations', request);
  expect(screen.getByText('Loading reservations…')).toBeInTheDocument();
  await act(async () => reject(new Error('Reservations unavailable.')));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Reservations unavailable.',
  );
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('No reservations match this view.');
});

test('manual refresh updates temporal phases from the server', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValueOnce(list())
    .mockResolvedValueOnce(list([{ ...reservation, phase: 'inProgress' }]));
  renderPage('/reservations?view=all', request);
  await screen.findByRole('button', {
    name: 'Cancel reservation for Microscope',
  });
  await user.click(
    screen.getByRole('button', { name: 'Refresh reservations' }),
  );
  await screen.findByText('In progress');
  expect(
    screen.queryByRole('button', { name: 'Cancel reservation for Microscope' }),
  ).not.toBeInTheDocument();
  expect(request.mock.calls[1][0]).toBe(request.mock.calls[0][0]);
});
