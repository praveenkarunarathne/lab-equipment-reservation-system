import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { AuthContext } from '../auth/authContext.js';
import AppRoutes from '../routes/AppRoutes.jsx';
import { apiRequest } from '../api/apiClient.js';

const item = {
  id: '0123456789abcdef01234567',
  assetCode: 'SCOPE-01',
  name: 'Microscope',
  category: 'Optics',
  location: 'Lab A',
  description: 'Teaching microscope',
  status: 'available',
  statusReason: null,
};
function page(data = [item], pagination = {}) {
  return {
    data,
    pagination: {
      page: 1,
      limit: 12,
      total: data.length,
      totalPages: data.length ? 1 : 0,
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

test('students default to available equipment and see no management controls', async () => {
  const request = vi.fn().mockResolvedValue(page());
  renderPage('/equipment', request);
  await screen.findByRole('link', { name: item.name });
  expect(
    new URL(request.mock.calls[0][0], 'http://test').searchParams.get('status'),
  ).toBe('available');
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue(
    'available',
  );
  expect(screen.getByText('SCOPE-01')).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Add equipment' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Edit Microscope' }),
  ).not.toBeInTheDocument();
});

test('admin catalog defaults to all statuses and links to creation and editing', async () => {
  const request = vi.fn().mockResolvedValue(page());
  renderPage('/admin/equipment', request, 'admin');
  await screen.findByRole('link', { name: 'Microscope' });
  expect(
    new URL(request.mock.calls[0][0], 'http://test').searchParams.has('status'),
  ).toBe(false);
  expect(screen.getByRole('link', { name: 'Add equipment' })).toHaveAttribute(
    'href',
    '/admin/equipment/new',
  );
  expect(screen.getByRole('link', { name: 'Edit Microscope' })).toHaveAttribute(
    'href',
    `/admin/equipment/${item.id}/edit`,
  );
});

test('applying search and category filters resets pagination and allows all statuses', async () => {
  const user = userEvent.setup();
  const request = vi.fn().mockResolvedValue(page());
  renderPage('/equipment?page=2', request);
  await screen.findByRole('link', { name: 'Microscope' });
  await user.click(screen.getByLabelText('Search equipment'));
  await user.paste(' scope [A] ');
  await user.type(screen.getByLabelText('Category'), ' Optics ');
  await user.selectOptions(screen.getByLabelText('Status'), 'all');
  request.mockResolvedValueOnce(page([]));
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  await screen.findByText('No equipment matches these filters.');
  const query = new URL(request.mock.calls.at(-1)[0], 'http://test')
    .searchParams;
  expect(query.get('page')).toBe('1');
  expect(query.get('q')).toBe('scope [A]');
  expect(query.get('category')).toBe('Optics');
  expect(query.has('status')).toBe(false);
  expect(screen.getByLabelText('Status')).toHaveValue('all');
});

test('pagination retains filters and updates navigation controls', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValueOnce(page([item], { total: 25, totalPages: 3 }))
    .mockResolvedValueOnce(
      page([{ ...item, id: 'second', name: 'Second scope' }], {
        page: 2,
        total: 25,
        totalPages: 3,
      }),
    );
  renderPage('/equipment?q=scope', request);
  await screen.findByRole('link', { name: 'Microscope' });
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('link', { name: 'Second scope' });
  expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  const query = new URL(request.mock.calls.at(-1)[0], 'http://test')
    .searchParams;
  expect(query.get('page')).toBe('2');
  expect(query.get('q')).toBe('scope');
});

test('details display operational status and reason with admin-only editing', async () => {
  const request = vi.fn().mockResolvedValue({
    ...item,
    status: 'maintenance',
    statusReason: 'Calibration required',
  });
  const first = renderPage(`/equipment/${item.id}`, request);
  await screen.findByRole('heading', { name: 'Microscope' });
  expect(screen.getByText('Maintenance')).toBeInTheDocument();
  expect(screen.getByText('Calibration required')).toBeInTheDocument();
  expect(screen.getByText('Teaching microscope')).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Edit equipment' }),
  ).not.toBeInTheDocument();
  first.unmount();
  renderPage(`/equipment/${item.id}`, request, 'admin');
  await screen.findByRole('link', { name: 'Edit equipment' });
});

test('catalog errors offer retry and replace the loading state with results', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('Database unavailable.'))
    .mockResolvedValueOnce(page());
  renderPage('/equipment', request);
  expect(screen.getByRole('status')).toHaveTextContent('Loading equipment…');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Database unavailable.',
  );
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('link', { name: 'Microscope' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('missing equipment shows a safe error instead of a detail or edit form', async () => {
  const request = vi.fn().mockRejectedValue(new Error('Equipment not found.'));
  renderPage(`/admin/equipment/${item.id}/edit`, request, 'admin');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Equipment not found.',
  );
  expect(
    screen.queryByRole('button', { name: 'Save equipment' }),
  ).not.toBeInTheDocument();
});

async function fillEquipment(user) {
  for (const [label, value] of [
    ['Asset code', item.assetCode],
    ['Name', item.name],
    ['Category', item.category],
    ['Location', item.location],
    ['Description', item.description],
  ])
    await user.type(screen.getByLabelText(label), value);
}

test('admins create equipment using only metadata and refetch the management list', async () => {
  const user = userEvent.setup();
  const request = vi
    .fn()
    .mockResolvedValueOnce(item)
    .mockResolvedValueOnce(page());
  renderPage('/admin/equipment/new', request, 'admin');
  await fillEquipment(user);
  await user.click(screen.getByRole('button', { name: 'Create equipment' }));
  await screen.findByRole('heading', { name: 'Manage equipment' });
  await screen.findByRole('link', { name: 'Microscope' });
  expect(request.mock.calls[0]).toEqual([
    '/equipment',
    {
      method: 'POST',
      body: {
        assetCode: item.assetCode,
        name: item.name,
        category: item.category,
        location: item.location,
        description: item.description,
      },
    },
  ]);
  expect(request.mock.calls[1][0]).toContain('/equipment?');
});

test('editing preloads metadata, preserves field values, and refetches after save', async () => {
  const user = userEvent.setup();
  const updated = { ...item, name: 'Updated microscope' };
  const request = vi
    .fn()
    .mockResolvedValueOnce(item)
    .mockResolvedValueOnce(updated)
    .mockResolvedValueOnce(page([updated]));
  renderPage(`/admin/equipment/${item.id}/edit`, request, 'admin');
  await screen.findByRole('heading', { name: 'Edit equipment' });
  expect(screen.getByLabelText('Asset code')).toHaveValue(item.assetCode);
  expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), updated.name);
  await user.click(screen.getByRole('button', { name: 'Save equipment' }));
  await screen.findByRole('link', { name: updated.name });
  const [path, options] = request.mock.calls[1];
  expect(path).toBe(`/equipment/${item.id}`);
  expect(options.method).toBe('PATCH');
  expect(options.body.name).toBe(updated.name);
  expect(Object.keys(options.body).sort()).toEqual([
    'assetCode',
    'category',
    'description',
    'location',
    'name',
  ]);
});

test('server field errors are accessible and saving disables the form until completion', async () => {
  const user = userEvent.setup();
  let fail;
  const request = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  renderPage('/admin/equipment/new', request, 'admin');
  await fillEquipment(user);
  await user.click(screen.getByRole('button', { name: 'Create equipment' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByLabelText('Asset code')).toBeDisabled();
  await act(async () =>
    fail(
      Object.assign(new Error('Request validation failed.'), {
        fieldErrors: { 'body.assetCode': ['Invalid asset code.'] },
      }),
    ),
  );
  expect(await screen.findByText('Invalid asset code.')).toBeInTheDocument();
  expect(screen.getByLabelText('Asset code')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.getByLabelText('Asset code')).toHaveValue(item.assetCode);
  expect(
    screen.getByRole('button', { name: 'Create equipment' }),
  ).toBeEnabled();
});

test('student management routes are blocked before any equipment request', async () => {
  const request = vi.fn();
  renderPage('/admin/equipment/new', request);
  await screen.findByRole('heading', { name: 'Access denied' });
  expect(request).not.toHaveBeenCalled();
});

test('an obsolete catalog response cannot replace newer filter results', async () => {
  const user = userEvent.setup();
  let finishOld;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce(page([{ ...item, name: 'New result' }]));
  renderPage('/equipment', request);
  await user.type(screen.getByLabelText('Search equipment'), 'new');
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  await screen.findByRole('link', { name: 'New result' });
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => finishOld(page()));
  expect(
    screen.queryByRole('link', { name: 'Microscope' }),
  ).not.toBeInTheDocument();
});

test('the API client retains list pagination while unwrapping single resources', async () => {
  const list = page();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(list))
      .mockResolvedValueOnce(Response.json({ data: item })),
  );
  expect(await apiRequest('/equipment')).toEqual(list);
  expect(await apiRequest(`/equipment/${item.id}`)).toEqual(item);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});
