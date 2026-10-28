import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { AuthContext } from '../auth/authContext.js';
import AppRoutes from '../routes/AppRoutes.jsx';

function renderWorkspace() {
  const request = vi.fn().mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
  });
  render(
    <AuthContext.Provider
      value={{
        user: { name: 'Test Student', role: 'student' },
        request,
        loading: false,
        error: null,
        logout: vi.fn(),
        retry: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={['/equipment']}>
        <AppRoutes />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

test('navigation can be opened and dismissed with Escape, restoring focus to the menu button', async () => {
  const user = userEvent.setup();
  renderWorkspace();
  await screen.findByText('No equipment matches these filters.');
  const toggle = screen.getByRole('button', { name: 'Open navigation' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.tab({ shift: true });
  expect(
    screen.getByRole('button', { name: 'Sign out', exact: true }),
  ).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link', { name: /Labspace/ })).toHaveFocus();
  expect(
    screen.getByRole('button', { name: 'Close navigation' }),
  ).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveFocus();
});

test('navigation indicates the current page and closes after changing routes', async () => {
  const user = userEvent.setup();
  renderWorkspace();
  await screen.findByText('No equipment matches these filters.');
  expect(
    screen.getByRole('link', { name: 'Equipment', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await user.click(screen.getByRole('button', { name: 'Open navigation' }));
  document.documentElement.scrollTop = 500;
  await user.click(
    screen.getByRole('link', { name: 'My reservations', exact: true }),
  );
  await screen.findByRole('heading', { name: 'My reservations' });
  expect(document.documentElement.scrollTop).toBe(0);
  expect(
    screen.getByRole('link', { name: 'My reservations', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  expect(
    screen.getByRole('button', { name: 'Open navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
  expect(
    screen.queryByRole('button', { name: 'Close navigation' }),
  ).not.toBeInTheDocument();
});

test('resizing to desktop releases the mobile navigation focus trap', async () => {
  const user = userEvent.setup();
  renderWorkspace();
  await user.click(screen.getByRole('button', { name: 'Open navigation' }));
  fireEvent(window, new Event('resize'));
  expect(
    screen.getByRole('button', { name: 'Open navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('main')).toHaveFocus();
});
