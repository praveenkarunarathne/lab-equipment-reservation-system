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

beforeAll(() => {
  // JSDOM does not implement the browser's modal dialog lifecycle.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

function renderDetail(request, role = 'admin') {
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
      <MemoryRouter initialEntries={[`/equipment/${item.id}`]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

async function requestMaintenance(user) {
  await screen.findByRole('heading', { name: 'Microscope' });
  await user.selectOptions(screen.getByLabelText('Status'), 'maintenance');
  await user.type(screen.getByLabelText('Reason'), ' Calibration ');
  await user.click(screen.getByRole('button', { name: 'Update status' }));
  return screen.findByRole('dialog', { name: 'Change equipment status?' });
}

test('students cannot see lifecycle controls', async () => {
  const request = vi.fn().mockResolvedValue(item);
  renderDetail(request, 'student');
  await screen.findByRole('heading', { name: 'Microscope' });
  expect(
    screen.queryByRole('button', { name: 'Update status' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Archive equipment' }),
  ).not.toBeInTheDocument();
});

test('non-available status needs a reason and cancellation confirmation before any mutation', async () => {
  const user = userEvent.setup();
  const request = vi.fn().mockResolvedValue(item);
  renderDetail(request);
  await screen.findByRole('heading', { name: 'Microscope' });
  await user.selectOptions(screen.getByLabelText('Status'), 'maintenance');
  expect(screen.getByLabelText('Reason')).toBeRequired();
  await user.click(screen.getByRole('button', { name: 'Update status' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  await user.type(screen.getByLabelText('Reason'), 'Calibration');
  await user.click(screen.getByRole('button', { name: 'Update status' }));
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByText(/will cancel all future active reservations/),
  ).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Reason')).toHaveValue('Calibration');
});

test('confirmed status changes refetch details and report the cancellation count', async () => {
  const user = userEvent.setup();
  const changed = {
    ...item,
    status: 'maintenance',
    statusReason: 'Calibration',
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(item)
    .mockResolvedValueOnce({ equipment: changed, cancelledReservationCount: 2 })
    .mockResolvedValueOnce(changed);
  renderDetail(request);
  const dialog = await requestMaintenance(user);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm status change' }),
  );
  await screen.findByText('Status saved. 2 future reservations cancelled.');
  expect(await screen.findByLabelText('Reason')).toHaveValue('Calibration');
  expect(screen.getByLabelText('Status')).toHaveValue('maintenance');
  expect(request.mock.calls[1]).toEqual([
    `/equipment/${item.id}/status`,
    {
      method: 'PATCH',
      body: { status: 'maintenance', reason: ' Calibration ' },
    },
  ]);
  expect(request.mock.calls[2][0]).toBe(`/equipment/${item.id}`);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('returning available sends no reason and explains that cancelled reservations remain cancelled', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      ...item,
      status: 'maintenance',
      statusReason: 'Calibration',
    })
    .mockResolvedValueOnce({ equipment: item, cancelledReservationCount: 0 })
    .mockResolvedValueOnce(item);
  renderDetail(request);
  await screen.findByRole('heading', { name: 'Microscope' });
  await user.selectOptions(screen.getByLabelText('Status'), 'available');
  expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Update status' }));
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByText(/Cancelled reservations will stay cancelled/),
  ).toBeInTheDocument();
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm status change' }),
  );
  await screen.findByText('Status saved. 0 future reservations cancelled.');
  expect(request.mock.calls[1][1].body).toEqual({ status: 'available' });
});

test('archive requires explicit confirmation, then refetches the management list', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValueOnce(item)
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({
      data: [],
      pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
    });
  renderDetail(request);
  await screen.findByRole('heading', { name: 'Microscope' });
  await user.click(screen.getByRole('button', { name: 'Archive equipment' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Archive equipment?',
  });
  expect(
    within(dialog).getByText(/cancels all future active reservations/),
  ).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm archive' }),
  );
  await screen.findByRole('heading', { name: 'Manage equipment' });
  await screen.findByText('No equipment matches these filters.');
  expect(request.mock.calls[1]).toEqual([
    `/equipment/${item.id}`,
    { method: 'DELETE' },
  ]);
  expect(request.mock.calls[2][0]).toContain('/equipment?');
});

test('server validation errors stay in the dialog and permit an explicit retry', async () => {
  const user = userEvent.setup();
  const failure = Object.assign(new Error('Request validation failed.'), {
    fieldErrors: { 'body.reason': ['A reason is required.'] },
  });
  const changed = {
    ...item,
    status: 'maintenance',
    statusReason: 'Calibration',
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(item)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce({ equipment: changed, cancelledReservationCount: 1 })
    .mockResolvedValueOnce(changed);
  renderDetail(request);
  const dialog = await requestMaintenance(user);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm status change' }),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'A reason is required.',
  );
  expect(request).toHaveBeenCalledTimes(2);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm status change' }),
  );
  await screen.findByText('Status saved. 1 future reservation cancelled.');
});

test('in-flight archive disables duplicate submission and prevents Escape from dismissing the dialog', async () => {
  const user = userEvent.setup();
  let reject;
  const request = vi
    .fn()
    .mockResolvedValueOnce(item)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
  renderDetail(request);
  await screen.findByRole('heading', { name: 'Microscope' });
  await user.click(screen.getByRole('button', { name: 'Archive equipment' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm archive' }),
  );
  expect(
    within(dialog).getByRole('button', { name: 'Saving…' }),
  ).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(dialog).toBeInTheDocument();
  await act(async () => reject(new Error('Service temporarily unavailable.')));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Service temporarily unavailable.',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});

test('Escape cancels an idle confirmation without sending a mutation', async () => {
  const user = userEvent.setup();
  const request = vi.fn().mockResolvedValue(item);
  renderDetail(request);
  const dialog = await requestMaintenance(user);
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
});
