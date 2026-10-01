const { test, expect, login, expectNoOverflow } = require('../fixtures.cjs');
const { urls } = require('../environment.cjs');
const { checkPasswordVisibility, checkOnboardingPasswords } = require('../password-visibility.cjs');

test('customer profile Edit saves contact details independently of password and notification settings', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Jordan Updated');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Jordan Updated');
  await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your preferences are updated.' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: "Open Jordan Updated's profile" }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Jordan Updated');
  await expectNoOverflow(page);
});

test('customer profile password change validates and rotates the session with a compact desktop layout', async ({ page, request, fixture }) => {
  await login(page, fixture, 'customer');
  const oldToken = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
  await expect(page.locator('.site-header').getByRole('link', { name: 'For business' })).toHaveCount(0);
  await expect(page.locator('.site-footer')).not.toContainText('Orlando · Miami');
  await expect(page.locator('.site-footer').getByRole('link', { name: 'For business' })).toBeVisible();
  await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toHaveCount(0);
  // Compare position in the dialog's content, not the viewport: on iPhone,
  // reaching the Change password button naturally scrolls the dialog.
  const contactPosition = () => page.getByLabel('Display name', { exact: true }).evaluate((element) => {
    const dialog = element.closest('.account-modal');
    const field = element.getBoundingClientRect();
    return { top: field.top - dialog.getBoundingClientRect().top + dialog.scrollTop, width: field.width };
  });
  const originalNamePosition = await contactPosition();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const expandedNamePosition = await contactPosition();
  expect(expandedNamePosition.top).toBeCloseTo(originalNamePosition.top, 0);
  expect(expandedNamePosition.width).toBeCloseTo(originalNamePosition.width, 0);
  const passwordForm = page.getByRole('form', { name: 'Change password' });
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  if (page.viewportSize().width > 850) expect(await page.locator('.account-modal').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await page.getByLabel('Current password', { exact: true }).fill(fixture.password);
  await page.getByLabel('New password', { exact: true }).fill('UpdatedFixturePassword123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('Mismatch123');
  await expect(passwordForm.getByRole('button', { name: 'Change password', exact: true })).toBeDisabled();
  await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedFixturePassword123');
  await page.getByRole('button', { name: 'Show new password', exact: true }).click();
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('Confirm new password', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Hide new password', exact: true }).click();
  await passwordForm.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Password changed. Other sessions have been signed out.' })).toBeVisible();
  const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
  expect(fresh).not.toBe(oldToken);
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(401);
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${fresh}` } })).status()).toBe(200);
  await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  for (const label of ['Current password', 'New password', 'Confirm new password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expectNoOverflow(page);
});

test('customer profile password failure and close preserve the session but clear unsaved secrets', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('WrongPassword123');
  await page.getByLabel('New password', { exact: true }).fill('UpdatedFixturePassword123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedFixturePassword123');
  await page.getByRole('form', { name: 'Change password' }).getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Current password is incorrect');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  for (const label of ['Current password', 'New password', 'Confirm new password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expectNoOverflow(page);
});

test('customer password visibility works in login, signup and reset without submitting', async ({ page }) => {
  const actions = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/auth/')) actions.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await checkPasswordVisibility(page, 'Password');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await checkPasswordVisibility(page, 'Password');
  await checkPasswordVisibility(page, 'Confirm password', 'confirmed password');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await expectNoOverflow(page);
  await page.goto('/?resetPassword=synthetic-visibility-token');
  await checkPasswordVisibility(page, 'New password');
  await checkPasswordVisibility(page, 'Confirm new password', 'confirmed password');
  await expectNoOverflow(page);
  await checkOnboardingPasswords(page);
  await expectNoOverflow(page);
  expect(actions).toEqual([]);
});
test('customer sign out everywhere revokes both sessions at the API', async ({ page, request, fixture }) => {
  await login(page, fixture, 'customer');
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
  const second = await request.post(`${urls.api}/api/auth/sign-in`, { data: { email: fixture.accounts.customer.email, password: fixture.password } });
  const other = (await second.json()).data.accessToken;
  await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
  await page.getByRole('button', { name: 'Sign out everywhere', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  for (const revoked of [token, other]) expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${revoked}` } })).status()).toBe(401);
});
test('failed customer logout retains the session and displays an error in the profile', async ({ page, request, fixture }) => {
  await login(page, fixture, 'customer');
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
  await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Security controls are temporarily unavailable. Please try again.' } }) }));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Security controls are temporarily unavailable');
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken)).toBe(token);
});
test('customer sign in persists across reload without horizontal overflow', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.reload();
  await expect(page.getByRole('button', { name: "Open Jordan Customer's profile" })).toBeVisible();
  await expectNoOverflow(page);
});

test('registration requires matching passwords and creates a real account', async ({ page, fixture }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Browser New Customer');
  await page.getByLabel('Email address', { exact: true }).fill('new@playwright.nitewide.test');
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByLabel('Confirm password', { exact: true }).fill('DoesNotMatch!2026');
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled();
  await page.getByLabel('Confirm password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: "Open Browser New Customer's profile" })).toBeVisible();
});

test('invalid credentials show a recoverable sign-in error', async ({ page, fixture }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByLabel('Email address').fill(fixture.accounts.customer.email);
  await page.getByLabel('Password', { exact: true }).fill('WrongPassword!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/password|credentials|incorrect|invalid/i);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
});

test('shared event opens directly, supports maps and saved state after reload', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await expect(details.getByRole('heading', { name: 'Playwright Friday Night' })).toBeVisible();
  await expect(details.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', /maps/);
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/customer/saved/${fixture.ids.event}`));
  await details.getByRole('button', { name: 'Save Playwright Friday Night', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(details.getByRole('button', { name: 'Unsave Playwright Friday Night', exact: true })).toBeVisible();
  await page.reload();
  await expect(details.getByRole('button', { name: 'Unsave Playwright Friday Night', exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).not.toHaveURL(/event=/);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('#saved').getByTestId('customer-event-card')).toHaveCount(1);
});

test('booking pagination and guestlist QR use the correct entry', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.getByRole('button', { name: 'Booked', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  const response = page.waitForResponse(r => r.url().includes('/customer/bookings') && r.url().includes('page=2'));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await response;
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  await page.goto(`/?tab=booked&booking=guestlist:${fixture.ids.entry}`);
  await expect(page.getByRole('img', { name: /QR code for guest list entry/ })).toBeVisible();
  await expect(page.getByText('3 guests · One code for your party', { exact: true })).toBeVisible();
  await expect(page.getByText('Ready for entry', { exact: true })).toBeVisible();
});

test('booking notifications open the exact pass and dismiss only that notification', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.getByRole('button', { name: /Your guestlist is approved/ }).click();
  await expect(page.getByRole('img', { name: /QR code for guest list entry/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`booking=guestlist(?:%3A|:)${fixture.ids.entry}`));
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('button', { name: /Your guestlist is approved/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Your tickets are confirmed/ }).click();
  await expect(page.getByRole('img', { name: /QR code for ticket 1/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${fixture.ids.order}`));
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByText('No notifications yet.', { exact: true })).toBeVisible();
});

test('clear all notifications persists without removing bookings', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.getByText('No notifications yet.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByText('No notifications yet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close notifications' }).click();
  await page.getByRole('button', { name: 'Booked', exact: true }).click();
  await expect(page.getByRole('button', { name: /View tickets for/ }).first()).toBeVisible();
});

test('pending guest can edit party size and withdraw without an admission QR', async ({ page, fixture }) => {
  await login(page, fixture, 'customer', 'pending');
  await page.goto(`/?tab=booked&booking=guestlist:${fixture.ids.pending}`);
  await expect(page.getByText('Pending review', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code for/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit spots' }).click();
  await page.getByLabel('Spots', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save spots' }).click();
  await expect(page.getByText('4 guests', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Withdraw request' }).click();
  await expect(page.getByRole('button', { name: /View guest list entry/ })).toHaveCount(0);
});

test('demo VIP checkout creates passes, a receipt and an asynchronous booking notification', async ({ page, request, fixture }) => {
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  const checkout = page.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'POST');
  await details.getByRole('button', { name: 'Confirm demo booking', exact: true }).click();
  const orderId = (await (await checkout).json()).data.order.id;
  await expect(details.getByRole('heading', { name: 'Your demo night is booked.' })).toBeVisible();
  await details.getByRole('button', { name: 'View my bookings', exact: true }).click();
  await page.getByRole('button', { name: /View tickets for Playwright Friday Night, 1 VIP Package/ }).click();
  await expect(page.getByText('Pass 1 of 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next pass' }).click();
  await expect(page.getByText('Pass 2 of 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code for ticket 2, VIP Package' })).toBeVisible();
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
  await expect.poll(async () => {
    const response = await request.get(`${urls.api}/api/notifications?page=1&pageSize=20`, { headers: { Authorization: `Bearer ${token}` } });
    const { data } = await response.json();
    return data.items.filter(item => item.kind === 'purchase_confirmed' && item.metadata?.orderId === orderId).length;
  }).toBe(1);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.getByRole('button', { name: /Demo booking recorded/ }).click();
  await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${orderId}`));
  await expect(page.getByRole('img', { name: 'QR code for ticket 1, VIP Package' })).toBeVisible();
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('button', { name: /Demo booking recorded/ })).toHaveCount(0);
});
