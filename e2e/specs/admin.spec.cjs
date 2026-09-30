const { test, expect, login, adminSection, expectNoOverflow } = require('../fixtures.cjs');
const { urls } = require('../environment.cjs');
test('admin sign out everywhere revokes its active sessions', async ({ page, request, fixture }) => {
  await login(page, fixture, 'admin');
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nitewide.admin.session')).accessToken);
  if (!await page.getByRole('button', { name: 'Sign out everywhere', exact: true }).isVisible()) await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'Sign out everywhere', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in securely', exact: true })).toBeVisible();
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
});
test('failed admin logout displays a recoverable error without clearing storage', async ({ page, fixture }) => {
  await login(page, fixture, 'admin');
  if (!await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible()) await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Security controls are temporarily unavailable. Please try again.' } }) }));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Security controls are temporarily unavailable');
  expect(await page.evaluate(() => Boolean(sessionStorage.getItem('nitewide.admin.session')))).toBe(true);
});
test('admin can sign in and navigate mobile and desktop management', async ({ page, fixture }) => {
  await login(page, fixture, 'admin');
  for (const section of ['Users', 'Events', 'Organizations']) {
    await adminSection(page, section);
    await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
    await expectNoOverflow(page);
  }
});

test('customer credentials cannot enter internal administration', async ({ page, fixture }) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(fixture.accounts.customer.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  await expect(page.getByRole('heading', { name: 'Sign in to command center' })).toBeVisible();
});

test('user search, backend pagination and audited profile editing persist', async ({ page, fixture }) => {
  await login(page, fixture, 'admin');
  await adminSection(page, 'Users');
  await expect(page.getByText('30 records', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByLabel('Search records').fill('Jordan Customer');
  const row = page.getByTestId('admin-record').filter({ hasText: 'Jordan Customer' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Manage record' }).click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel(/^Display name/).fill('Jordan Updated');
  await page.getByLabel('Required audit reason').fill('Playwright profile regression');
  await page.getByRole('button', { name: 'Save audited changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Search records').fill('Jordan Updated');
  await expect(page.getByTestId('admin-record')).toContainText('Jordan Updated');
  await adminSection(page, 'Audit log');
  await expect(page.getByTestId('admin-record').first()).toBeVisible();
  await page.getByTestId('admin-record').first().getByRole('button', { name: 'Manage record' }).click();
  await expect(page.getByRole('dialog')).toContainText('admin.user.updated');
  await expect(page.getByRole('dialog')).toContainText(fixture.accounts.customer.id);
});

test('suspend and restore a customer with retained history and explicit confirmation', async ({ page, fixture }) => {
  await login(page, fixture, 'admin');
  await adminSection(page, 'Users');
  await page.getByLabel('Search records').fill('Jordan Customer');
  await page.getByTestId('admin-record').getByRole('button', { name: 'Manage record' }).click();
  await page.getByRole('button', { name: 'Suspend user', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Required audit reason').fill('Playwright suspension test');
  await expect(dialog.getByRole('button', { name: 'Suspend user', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Suspend user', exact: true }).click();
  await expect(page.getByTestId('admin-record')).toContainText('suspended');
  await page.getByTestId('admin-record').getByRole('button', { name: 'Manage record' }).click();
  await page.getByRole('button', { name: 'Restore user', exact: true }).click();
  await dialog.getByLabel('Required audit reason').fill('Playwright restoration test');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Restore user', exact: true }).click();
  await expect(page.getByTestId('admin-record')).toContainText('Active');
  await adminSection(page, 'Orders & payments');
  await expect(page.getByText('12 records', { exact: true })).toBeVisible();
});

test('archive an event with a paid order retains that purchase', async ({ page, fixture }) => {
  await login(page, fixture, 'admin');
  await adminSection(page, 'Events');
  await page.getByLabel('Search records').fill('Playwright Friday Night');
  await page.getByTestId('admin-record').getByRole('button', { name: 'Manage record' }).click();
  await page.getByRole('button', { name: 'Archive event', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Required audit reason').fill('Playwright archive retains history');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Archive event', exact: true }).click();
  await expect(page.getByTestId('admin-record')).toContainText('archived');
  await adminSection(page, 'Orders & payments');
  await page.getByLabel('Search records').fill(fixture.ids.order);
  await expect(page.getByTestId('admin-record')).toHaveCount(1);
});

test('onboard a creator with setup email mocked and no password exposed', async ({ page, request, fixture }) => {
  await login(page, fixture, 'admin');
  await adminSection(page, 'Management');
  await page.getByRole('button', { name: 'Onboard business or creator' }).click();
  const dialog = page.getByRole('dialog', { name: 'Onboard business or creator', exact: true });
  await dialog.getByLabel('Business type').selectOption('independent_creator');
  await dialog.getByLabel('Full name').fill('Browser Independent Creator');
  await dialog.getByLabel('Email', { exact: true }).fill('creator@playwright.nitewide.test');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByLabel('Required audit reason').fill('Playwright onboarding regression');
  await dialog.getByRole('button', { name: 'Prepare and invite recipient' }).click();
  await expect(dialog).toContainText('Onboarding prepared.');
  await expect(dialog).toContainText('Setup email is queued.');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  const { urls, controlToken } = require('../environment.cjs');
  const response = await request.get(`${urls.api}/__e2e/emails`, { headers: { 'x-e2e-control': controlToken } });
  const emails = await response.json();
  expect(emails).toEqual(expect.arrayContaining([expect.objectContaining({ to: 'creator@playwright.nitewide.test', template: 'nitewide-account-setup' })]));
});
