import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { AuthContext } from '../auth/authContext.js';
import AppRoutes from '../routes/AppRoutes.jsx';

const equipment = {
  id: '0123456789abcdef01234567',
  name: 'Microscope',
  assetCode: 'SCOPE-01',
  location: 'Lab A',
  category: 'Optics',
  status: 'available',
  archived: false,
};
const report = {
  id: 'abcdef0123456789abcdef01',
  title: 'Unstable image',
  category: 'malfunction',
  description: 'The image flickers during normal operation.',
  status: 'open',
  equipment,
  createdAt: '2026-10-26T03:00:00.000Z',
  updatedAt: '2026-10-26T03:00:00.000Z',
  resolutionNote: null,
  resolvedAt: null,
  resolvedBy: null,
};
const reporter = {
  id: '123456789abcdef012345678',
  name: 'Student One',
  email: 'student@example.com',
};
const resolved = {
  ...report,
  status: 'resolved',
  resolutionNote: 'Replaced loose connector.',
  resolvedAt: '2026-10-26T04:00:00.000Z',
  resolvedBy: { name: 'Administrator', email: 'admin@example.com' },
};
function list(records = [report], pagination = {}) {
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
async function fillReport(user) {
  await user.selectOptions(await screen.findByLabelText('Category'), 'safety');
  await user.type(screen.getByLabelText('Title'), 'Loose connector');
  await user.type(
    screen.getByLabelText('Description'),
    'The power connector is visibly loose.',
  );
}

test('student can choose equipment through the catalog and open the report form from equipment details', async () => {
  const user = userEvent.setup();
  const request = vi.fn(async (path) => {
    if (path.startsWith('/equipment?')) return list([equipment]);
    if (path.endsWith('/availability')) return { bookable: false, slots: [] };
    return equipment;
  });
  renderPage('/fault-reports/new', request);
  await user.click(screen.getByRole('link', { name: 'Choose equipment' }));
  await user.click(
    await screen.findByRole('link', { name: 'Microscope', exact: true }),
  );
  await user.click(
    await screen.findByRole('link', { name: 'Report a fault', exact: true }),
  );
  await screen.findByRole('heading', { name: 'Report a fault' });
  await screen.findByLabelText('Title');
  expect(screen.getByRole('note')).toHaveTextContent(
    'Do not use equipment you suspect is unsafe. Inform laboratory staff immediately.',
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'does not replace physical safety procedures',
  );
});

test('form shows exact categories, text limits and safety guidance, then submits only report fields', async () => {
  const user = userEvent.setup();
  const request = vi.fn(async (path, options) => {
    if (path.startsWith('/equipment/')) return equipment;
    if (path === '/fault-reports') {
      expect(options).toEqual({
        method: 'POST',
        body: {
          equipmentId: equipment.id,
          category: 'safety',
          title: 'Loose connector',
          description: 'The power connector is visibly loose.',
        },
      });
      return report;
    }
    return report;
  });
  renderPage(`/fault-reports/new?equipmentId=${equipment.id}`, request);
  await fillReport(user);
  expect(
    within(screen.getByLabelText('Category'))
      .getAllByRole('option')
      .map((option) => option.value),
  ).toEqual(['', 'malfunction', 'damage', 'calibration', 'safety', 'other']);
  expect(screen.getByLabelText('Title')).toHaveAttribute('maxlength', '100');
  expect(screen.getByLabelText('Description')).toHaveAttribute(
    'minlength',
    '10',
  );
  expect(screen.getByLabelText('Description')).toHaveAttribute(
    'maxlength',
    '2000',
  );
  expect(screen.queryByLabelText(/upload/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Submit report' }));
  await screen.findByRole('heading', { name: report.title });
  await screen.findByText('Fault report submitted for staff review.');
  expect(
    screen.queryByRole('button', { name: 'Resolve report' }),
  ).not.toBeInTheDocument();
});

test('creation displays field errors without losing input and permits explicit retry', async () => {
  const user = userEvent.setup();
  const failure = Object.assign(new Error('Request validation failed.'), {
    fieldErrors: {
      'body.title': ['Title must contain at least 5 characters.'],
    },
  });
  const request = vi
    .fn()
    .mockResolvedValueOnce(equipment)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(report)
    .mockResolvedValueOnce(report);
  renderPage(`/fault-reports/new?equipmentId=${equipment.id}`, request);
  await fillReport(user);
  await user.click(screen.getByRole('button', { name: 'Submit report' }));
  expect(
    await screen.findByText('Title must contain at least 5 characters.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Title')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.getByLabelText('Title')).toHaveValue('Loose connector');
  await user.click(screen.getByRole('button', { name: 'Submit report' }));
  await screen.findByText('Fault report submitted for staff review.');
});

test('pending creation disables the form and prevents repeated submissions', async () => {
  const user = userEvent.setup();
  let resolve;
  const request = vi
    .fn()
    .mockResolvedValueOnce(equipment)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(report);
  renderPage(`/fault-reports/new?equipmentId=${equipment.id}`, request);
  await fillReport(user);
  await user.click(screen.getByRole('button', { name: 'Submit report' }));
  expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  expect(screen.getByLabelText('Title')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Submitting…' }));
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => resolve(report));
});

test('archived or missing equipment prevents reporting and offers a safe retry', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('Equipment not found.'))
    .mockResolvedValueOnce(equipment);
  renderPage(`/fault-reports/new?equipmentId=${equipment.id}`, request);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Equipment not found.',
  );
  expect(
    screen.queryByRole('button', { name: 'Submit report' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByLabelText('Title');
});

test('admin cannot submit reports and student cannot open admin management', async () => {
  const request = vi.fn();
  const first = renderPage(
    `/fault-reports/new?equipmentId=${equipment.id}`,
    request,
    'admin',
  );
  await screen.findByRole('heading', { name: 'Access denied' });
  expect(request).not.toHaveBeenCalled();
  first.unmount();
  renderPage('/admin/fault-reports', request);
  await screen.findByRole('heading', { name: 'Access denied' });
  expect(request).not.toHaveBeenCalled();
});

test('student history filters status and paginates without leaking other filters', async () => {
  const user = userEvent.setup();
  const request = vi.fn(async (path) =>
    list([report], {
      page: Number(new URL(path, 'http://test').searchParams.get('page')),
      total: 25,
      totalPages: 3,
    }),
  );
  renderPage('/fault-reports?status=open&page=2&reportedBy=other', request);
  await screen.findByText('25 fault reports found.');
  expect(request.mock.calls[0][0]).toBe(
    '/fault-reports/mine?page=2&limit=12&status=open',
  );
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Page 3 of 3');
  expect(request.mock.calls.at(-1)[0]).toBe(
    '/fault-reports/mine?page=3&limit=12&status=open',
  );
  await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  await screen.findByText('Page 1 of 3');
  expect(request.mock.calls.at(-1)[0]).toBe(
    '/fault-reports/mine?page=1&limit=12&status=resolved',
  );
  expect(
    screen.queryByRole('button', { name: 'Only this reporter' }),
  ).not.toBeInTheDocument();
});

test('admin filters by reporter and equipment, then can clear filters', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValue(list([{ ...report, reportedBy: reporter }]));
  renderPage('/admin/fault-reports', request, 'admin');
  await screen.findByText(reporter.email);
  await user.click(screen.getByRole('button', { name: 'Only this reporter' }));
  await screen.findByText(reporter.email);
  expect(request.mock.calls.at(-1)[0]).toContain(`reportedBy=${reporter.id}`);
  await user.click(screen.getByRole('button', { name: 'Only this equipment' }));
  await screen.findByText(reporter.email);
  expect(request.mock.calls.at(-1)[0]).toContain(`equipmentId=${equipment.id}`);
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await screen.findByText(reporter.email);
  expect(request.mock.calls.at(-1)[0]).toBe('/fault-reports?page=1&limit=12');
});

test('admin own-report route redirects to management', async () => {
  const request = vi.fn().mockResolvedValue(list([]));
  renderPage('/fault-reports', request, 'admin');
  await screen.findByRole('heading', { name: 'Manage fault reports' });
  await screen.findByText('No fault reports match these filters.');
  expect(request.mock.calls[0][0]).toBe('/fault-reports?page=1&limit=12');
});

test('report lists show loading and retryable errors before an empty result', async () => {
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
  renderPage('/fault-reports', request);
  expect(screen.getByText('Loading fault reports…')).toBeInTheDocument();
  await act(async () => reject(new Error('Reports unavailable.')));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Reports unavailable.',
  );
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('No fault reports match these filters.');
});

test('owner detail renders report text safely and shows resolution with archived equipment history', async () => {
  const description = '<img src=x onerror="alert(1)"> Suspected unsafe part.';
  renderPage(
    `/fault-reports/${report.id}`,
    vi.fn().mockResolvedValue({
      ...resolved,
      description,
      equipment: { ...equipment, archived: true },
    }),
  );
  await screen.findByText(description);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/Microscope \(Archived\)/)).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Microscope' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(resolved.resolutionNote)).toBeInTheDocument();
  expect(screen.getByText('Resolved by: Administrator')).toBeInTheDocument();
  expect(screen.queryByLabelText('Resolution note')).not.toBeInTheDocument();
});

test('detail handles a missing legacy equipment reference', async () => {
  renderPage(
    `/fault-reports/${report.id}`,
    vi.fn().mockResolvedValue({ ...report, equipment: null }),
  );
  await screen.findByText('Equipment no longer available');
});

test('a non-owned report displays a safe error and no report content or resolution form', async () => {
  renderPage(
    `/fault-reports/${report.id}`,
    vi.fn().mockRejectedValue(new Error('Fault report not found.')),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Fault report not found.',
  );
  expect(screen.queryByText(report.description)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Resolution note')).not.toBeInTheDocument();
});

test('administrator resolves an archived equipment report with a note and refetches the detail', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      ...report,
      equipment: { ...equipment, archived: true },
      reportedBy: reporter,
    })
    .mockResolvedValueOnce(resolved)
    .mockResolvedValueOnce(resolved);
  renderPage(`/fault-reports/${report.id}`, request, 'admin');
  await user.type(
    await screen.findByLabelText('Resolution note'),
    'Replaced loose connector.',
  );
  expect(
    screen.getByText(
      /Resolving this report does not change equipment availability/,
    ),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Resolve report', exact: true }),
  );
  await screen.findByText('Fault report resolved.');
  await screen.findByText(resolved.resolutionNote);
  expect(request.mock.calls[1]).toEqual([
    `/fault-reports/${report.id}/resolve`,
    { method: 'PATCH', body: { resolutionNote: 'Replaced loose connector.' } },
  ]);
  expect(request.mock.calls[2][0]).toBe(`/fault-reports/${report.id}`);
  expect(screen.queryByLabelText('Resolution note')).not.toBeInTheDocument();
});

test('resolution field errors preserve the note for an explicit retry', async () => {
  const user = userEvent.setup();
  const failure = Object.assign(new Error('Request validation failed.'), {
    fieldErrors: {
      'body.resolutionNote': ['Enter at least 5 characters after trimming.'],
    },
  });
  const request = vi
    .fn()
    .mockResolvedValueOnce(report)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(resolved)
    .mockResolvedValueOnce(resolved);
  renderPage(`/fault-reports/${report.id}`, request, 'admin');
  await user.type(
    await screen.findByLabelText('Resolution note'),
    'Valid note',
  );
  await user.click(
    screen.getByRole('button', { name: 'Resolve report', exact: true }),
  );
  await screen.findByText('Enter at least 5 characters after trimming.');
  expect(screen.getByLabelText('Resolution note')).toHaveValue('Valid note');
  expect(screen.getByLabelText('Resolution note')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await user.click(
    screen.getByRole('button', { name: 'Resolve report', exact: true }),
  );
  await screen.findByText('Fault report resolved.');
});

test('concurrent resolution conflict refreshes the winning note without resubmitting', async () => {
  const user = userEvent.setup();
  const failure = Object.assign(
    new Error('This fault report has already been resolved.'),
    { code: 'FAULT_ALREADY_RESOLVED', status: 409 },
  );
  const request = vi
    .fn()
    .mockResolvedValueOnce(report)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(resolved);
  renderPage(`/fault-reports/${report.id}`, request, 'admin');
  await user.type(
    await screen.findByLabelText('Resolution note'),
    'My different resolution',
  );
  await user.click(
    screen.getByRole('button', { name: 'Resolve report', exact: true }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'already been resolved',
  );
  await screen.findByText(resolved.resolutionNote);
  expect(screen.queryByLabelText('Resolution note')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(3);
});

test('resolution disables repeated submission while pending and recovers after a network error', async () => {
  const user = userEvent.setup();
  let reject;
  const request = vi
    .fn()
    .mockResolvedValueOnce(report)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
  renderPage(`/fault-reports/${report.id}`, request, 'admin');
  await user.type(
    await screen.findByLabelText('Resolution note'),
    'Valid resolution note',
  );
  await user.click(
    screen.getByRole('button', { name: 'Resolve report', exact: true }),
  );
  expect(screen.getByRole('button', { name: 'Resolving…' })).toBeDisabled();
  expect(screen.getByLabelText('Resolution note')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Resolving…' }));
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => reject(new Error('Service unavailable.')));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Service unavailable.',
  );
  expect(screen.getByLabelText('Resolution note')).toBeEnabled();
});
