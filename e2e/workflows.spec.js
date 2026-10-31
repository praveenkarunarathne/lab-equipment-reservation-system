import { test, expect } from '@playwright/test';
import { PASSWORD, ADMIN_EMAIL, STUDENT_EMAIL } from './config.js';

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: email === ADMIN_EMAIL ? 'Administration' : 'Equipment',
      exact: true,
    }),
  ).toBeVisible();
}
async function signOut(page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible();
}

test('mobile navigation respects reduced motion and preserves keyboard focus', async ({
  page,
}) => {
  await login(page, STUDENT_EMAIL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const toggle = page.getByRole('button', { name: 'Open navigation' });
  await toggle.click();
  const sidebar = page.getByRole('complementary');
  await expect(sidebar).toBeVisible();
  expect(await sidebar.evaluate((element) => element.style.transform)).toBe('');
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await toggle.click();
  await expect(sidebar).toHaveCSS('opacity', '1');
  await page
    .getByRole('link', { name: 'My reservations', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'My reservations' }),
  ).toBeVisible();
  await expect(page.getByRole('main')).toBeFocused();
});

test('production HTTPS restores secure sessions and enforces API, CSRF and role boundaries', async ({
  page,
}) => {
  await login(page, STUDENT_EMAIL);
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === '__Host-lab.sid',
  );
  expect(cookie).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  });
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'My reservations' }),
  ).toBeVisible();
  const forbidden = await page.request.get('/api/v1/admin/dashboard');
  expect(forbidden.status()).toBe(403);
  const noCsrf = await page.request.post('/api/v1/reservations', { data: {} });
  expect((await noCsrf.json()).error.code).toBe('CSRF_INVALID');
  const token = (await (await page.request.get('/api/v1/auth/csrf')).json())
    .data.csrfToken;
  const crossOrigin = await page.request.post('/api/v1/auth/logout', {
    headers: { Origin: 'https://another.example.test', 'X-CSRF-Token': token },
  });
  expect((await crossOrigin.json()).error.code).toBe('CSRF_INVALID');
  const health = await page.request.get('/api/v1/health');
  expect(health.headers()['cache-control']).toBe('no-store');
  expect(health.headers()['content-security-policy']).toContain(
    "script-src 'self'",
  );
  expect(health.headers()['content-security-policy']).not.toContain(
    'unsafe-inline',
  );
  expect(health.headers()['strict-transport-security']).toContain('max-age=');
  const unknown = await page.request.get('/api/v1/not-a-route', {
    headers: { Accept: 'text/html' },
  });
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()['content-type']).toContain('application/json');
  const scriptPath = await page
    .locator('script[src]')
    .first()
    .getAttribute('src');
  expect(
    (await page.request.get(scriptPath)).headers()['cache-control'],
  ).toContain('immutable');
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'Access denied' }),
  ).toBeVisible();
  await signOut(page);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
});

test('student registers, books a server slot, cancels, and sees staff resolution of a text-only fault', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Registered Student');
  await page.getByLabel('Email').fill('registered@example.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByText('Account created. Sign in to continue.'),
  ).toBeVisible();
  await login(page, 'registered@example.test');
  await page
    .getByRole('link', { name: 'Booking microscope', exact: true })
    .click();
  await page.getByLabel('Available slot').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Book slot', exact: true }).click();
  await page.getByRole('link', { name: 'View my reservations' }).click();
  await page
    .getByRole('button', { name: 'Cancel reservation for Booking microscope' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Cancel reservation?' });
  expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(
    true,
  );
  await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(
    page.getByText('No reservations match this view.'),
  ).toBeVisible();
  await page.getByLabel('View', { exact: true }).selectOption('history');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(
    page.getByText('Cancelled by student', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Booking microscope', exact: true })
    .click();
  await page.getByRole('link', { name: 'Report a fault', exact: true }).click();
  await expect(page.getByRole('note')).toContainText(
    'Inform laboratory staff immediately',
  );
  await page.getByLabel('Category', { exact: true }).selectOption('safety');
  await page.getByLabel('Title', { exact: true }).fill('Loose power connector');
  const description =
    '<img src=x onerror="alert(1)"> The connector moves during use.';
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(
    page.getByText('Fault report submitted for staff review.'),
  ).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  const reportUrl = page.url();
  await signOut(page);
  await login(page, ADMIN_EMAIL);
  await page
    .getByRole('link', { name: 'Manage fault reports', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Loose power connector', exact: true })
    .click();
  await page
    .getByLabel('Resolution note')
    .fill('Replaced connector and tested insulation.');
  await page
    .getByRole('button', { name: 'Resolve report', exact: true })
    .click();
  await expect(page.getByText('Fault report resolved.')).toBeVisible();
  await page
    .getByRole('link', { name: 'Booking microscope', exact: true })
    .click();
  await expect(page.locator('.status-badge')).toHaveText('Available');
  await signOut(page);
  await login(page, 'registered@example.test');
  await page.goto(reportUrl);
  await expect(
    page.getByText('Replaced connector and tested insulation.'),
  ).toBeVisible();
  await expect(page.getByLabel('Resolution note')).toHaveCount(0);
});

test('admin creates, edits and archives equipment through confirmed lifecycle controls', async ({
  page,
}) => {
  await login(page, ADMIN_EMAIL);
  await expect(
    page.getByRole('heading', { name: 'Administration' }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Manage equipment', exact: true })
    .click();
  await page.getByRole('link', { name: 'Add equipment' }).click();
  for (const [label, value] of [
    ['Asset code', 'NEW-01'],
    ['Name', 'Created meter'],
    ['Category', 'Electronics'],
    ['Location', 'Lab B'],
    ['Description', 'A new measurement device.'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Create equipment' }).click();
  await page
    .getByRole('link', { name: 'Edit Created meter', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Edited meter');
  await page.getByRole('button', { name: 'Save equipment' }).click();
  await page.getByRole('link', { name: 'Edited meter', exact: true }).click();
  await page
    .getByRole('button', { name: 'Archive equipment', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm archive', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Manage equipment' }),
  ).toBeVisible();
  await expect(page.getByText(/equipment items found/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edited meter', exact: true }),
  ).toHaveCount(0);
});

test('maintenance cancels future bookings and archive preserves resolvable fault history', async ({
  page,
}) => {
  await login(page, ADMIN_EMAIL);
  await page.getByRole('link', { name: 'Equipment', exact: true }).click();
  await page
    .getByRole('link', { name: 'Lifecycle oscilloscope', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Lifecycle oscilloscope', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('maintenance');
  await page.getByLabel('Reason', { exact: true }).fill('Calibration required');
  await page.getByRole('button', { name: 'Update status' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm status change' })
    .click();
  await expect(
    page.getByText('Status saved. 1 future reservation cancelled.'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Archive equipment', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm archive' })
    .click();
  await page
    .getByRole('link', { name: 'Manage fault reports', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Calibration drifts', exact: true })
    .click();
  await expect(
    page.getByText(/Lifecycle oscilloscope \(Archived\)/),
  ).toBeVisible();
  await page
    .getByLabel('Resolution note')
    .fill('Archived and referred to laboratory staff.');
  await page
    .getByRole('button', { name: 'Resolve report', exact: true })
    .click();
  await expect(page.getByText('Fault report resolved.')).toBeVisible();
  await page
    .getByRole('link', { name: 'Manage reservations', exact: true })
    .click();
  await page.getByLabel('View', { exact: true }).selectOption('history');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(
    page.getByText('Equipment under maintenance', { exact: false }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(
    page
      .getByRole('link', { name: 'Current equipment', exact: true })
      .locator('..')
      .locator('..')
      .locator('dd'),
  ).toHaveText('1');
});
