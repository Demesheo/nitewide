const { test, expect, login, expectNoOverflow } = require('../fixtures.cjs');
const { expectBrandImage, expectBrandIcons } = require('../brand-checks.cjs');
const { urls } = require('../environment.cjs');
const { checkPasswordVisibility, checkOnboardingPasswords } = require('../password-visibility.cjs');

test('approved brand logo and favicon load without changing customer header or footer navigation', async ({ page }) => {
  await page.goto('/');
  const home = page.getByRole('banner').getByRole('link', { name: 'Nitewide home', exact: true });
  await expectBrandImage(home.locator('img'));
  await expectBrandIcons(page);
  await expectNoOverflow(page);
  await test.info().attach('customer-brand-header', { body: await page.screenshot(), contentType: 'image/png' });
  const footer = page.getByRole('contentinfo');
  await footer.scrollIntoViewIfNeeded();
  await expectBrandImage(footer.getByRole('link', { name: 'Nitewide home', exact: true }).locator('img'));
  await expect(footer.getByRole('link', { name: 'For business', exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await footer.getByRole('link', { name: 'Nitewide home', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/' && !url.searchParams.has('event'));
  await expect(home).toBeVisible();
});

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

for (const recovery of ['reload', 'retry']) test(`checkout survives a committed order with a lost response and ${recovery} opens its exact passes`, async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  let orderId;
  let posts = 0;
  let releaseResponse;
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  await page.route('**/api/orders', async route => {
    posts += 1;
    const response = await route.fetch();
    orderId = (await response.json()).data.order.id;
    await responseGate;
    await route.abort('failed');
  });
  await details.getByRole('button', { name: 'Confirm demo booking', exact: true }).click();
  await expect.poll(() => orderId).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(details).toBeVisible();
  await expect(details.getByRole('button', { name: 'Back to tickets & tables' })).toBeDisabled();
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(details).toBeVisible();
  releaseResponse();
  await expect(details.getByRole('button', { name: 'Check / retry booking' })).toBeEnabled();
  if (recovery === 'reload') {
    // A committed purchase remains recoverable when public discovery can no
    // longer return the event (for example, after the host unpublishes it).
    await page.route(`**/api/events/${fixture.ids.event}`, route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Event unavailable' } }) }));
    await page.reload();
  }
  else await details.getByRole('button', { name: 'Check / retry booking' }).click();
  await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${orderId}`));
  await expect(page.getByRole('img', { name: 'QR code for ticket 1, VIP Package' })).toBeVisible();
  expect(posts).toBe(1);
  const pending = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('nitewide.session'));
    return localStorage.getItem(`nitewide.checkout.${session.user.id}`);
  });
  expect(pending).toBeNull();
});

test('pending checkout status preserves its key and never submits another order', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  let posts = 0;
  const keys = [];
  await page.route('**/api/customer/checkout-attempts/*', route => {
    keys.push(route.request().url().split('/').pop());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { status: 'pending' } }) });
  });
  await page.route('**/api/orders', route => { posts += 1; return route.abort(); });
  await details.getByRole('button', { name: 'Confirm demo booking', exact: true }).click();
  await expect(details.getByRole('alert').filter({ hasText: 'still being checked' })).toBeVisible();
  await details.getByRole('button', { name: 'Check / retry booking' }).click();
  await expect(details.getByRole('button', { name: 'Check / retry booking' })).toBeEnabled();
  expect(posts).toBe(0);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test('sandbox checkout checks server payment status and recovers exact passes without contacting Stripe', async ({ page, fixture }) => {
  await page.route('https://js.stripe.com/**', route => route.abort());
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: true, configured: true, mode: 'test', publishableKey: 'pk_test_fixture_offline', demoEnabled: false } } }));
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  let key;
  await page.route('**/api/customer/checkout-attempts/*', route => route.fulfill({ status: 404, json: { error: { message: 'Absent' } } }));
  await page.route('**/api/customer/payment-checkouts', route => {
    const body = route.request().postDataJSON();
    key = body.idempotencyKey;
    expect(body.payment).toBeUndefined();
    return route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', clientSecret: 'fixture_checkout_secret', stripeAccountId: 'acct_fixture', expiresAt: new Date(Date.now() + 300000).toISOString() } } });
  });
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/verify`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'paid' } } }));
  await details.getByRole('button', { name: 'Continue to payment', exact: true }).click();
  await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Check booking', exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('nitewide.session')).user;
    return localStorage.getItem(`nitewide.checkout.${user.id}`);
  });
  expect(saved).toContain(key); expect(saved).not.toContain('fixture_checkout_secret');
  await details.getByRole('button', { name: /^Pay / }).click();
  await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${fixture.ids.order}`));
  await expect(page.getByRole('img', { name: /QR code for ticket 1/ })).toBeVisible();
  await expectNoOverflow(page);
});

test('incomplete sandbox configuration shows unavailable payments without falling back to demo', async ({ page, fixture }) => {
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: false, configured: true, mode: 'test', publishableKey: null, demoEnabled: true } } }));
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  await expect(details.getByRole('button', { name: 'Payments unavailable' })).toBeDisabled();
  await expect(details.getByRole('button', { name: 'Confirm demo booking' })).toHaveCount(0);
  await expect(details).toContainText('Paid booking will be available');
  await expectNoOverflow(page);
});

test('sandbox payment review preserves the booking without retrying payment or opening passes', async ({ page, fixture }) => {
  await page.route('https://js.stripe.com/**', route => route.abort());
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: true, configured: true, mode: 'test', publishableKey: 'pk_test_fixture_offline', demoEnabled: false } } }));
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  let prepares = 0;
  let reviews = false;
  await page.route('**/api/customer/checkout-attempts/*', route => reviews ? route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', verificationStatus: 'review' } } }) : route.fulfill({ status: 404, json: { error: { message: 'Absent' } } }));
  await page.route('**/api/customer/payment-checkouts', route => { prepares += 1; reviews = true; return route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', verificationStatus: 'review' } } }); });
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/verify`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', verificationStatus: 'review' } } }));
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/resume`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', verificationStatus: 'review' } } }));
  await details.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(details.getByRole('status')).toContainText('needs review');
  await expect(details.getByRole('button', { name: 'Cancel payment attempt' })).toHaveCount(0);
  await expect(details.getByRole('button', { name: /^Pay / })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Check booking' })).toHaveCount(0);
  await page.route(`**/api/events/${fixture.ids.event}`, route => route.fulfill({ status: 404, json: { error: { message: 'Event unavailable' } } }));
  await page.reload();
  await expect(details.getByRole('status')).toContainText('needs review');
  expect(prepares).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem(`nitewide.checkout.${JSON.parse(localStorage.getItem('nitewide.session')).user.id}`))).toBeTruthy();
  await expect(page.getByRole('img', { name: /QR code for ticket/ })).toHaveCount(0);
  await expectNoOverflow(page);
});

async function abandonedCheckoutFixture(page, fixture) {
  await page.route('https://js.stripe.com/**', route => route.abort());
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: true, configured: true, mode: 'test', publishableKey: 'pk_test_fixture_offline', demoEnabled: false } } }));
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
  const response = await page.request.get(`${urls.api}/api/customer/bookings?page=1`, { headers: { Authorization: `Bearer ${token}` } });
  const bookings = (await response.json()).data;
  const order = bookings.orders.find(item => item.id === fixture.ids.order);
  expect(order).toBeTruthy();
  const booking = { idempotencyKey: 'abandoned-original-key', event: order.event, subtotalCents: order.subtotalCents,
    totalCents: order.totalCents, currency: order.currency, items: order.items.map(item => ({ offeringId: fixture.ids.offering, name: item.name, kind: 'package', quantity: item.quantity, unitPriceCents: item.lineTotalCents / item.quantity })) };
  const reminder = { id: fixture.ids.order, kind: 'checkout_pending', eventId: order.event.id,
    title: 'Purchase incomplete', message: `Continue your purchase for ${order.event.title}?`,
    metadata: { orderId: fixture.ids.order }, createdAt: new Date().toISOString(), readAt: null };
  await page.route('**/api/notifications?**', route => route.fulfill({ json: { data: {
    items: [reminder], total: 1, unreadCount: reminder.readAt ? 0 : 1, hasMore: false, page: 1, pageSize: 20,
  } } }));
  await page.route(`**/api/notifications/${fixture.ids.order}/read`, route => {
    reminder.readAt = new Date().toISOString(); return route.fulfill({ json: { data: reminder } });
  });
  await page.route(`**/api/notifications/${fixture.ids.order}`, route => { expect(route.request().method()).not.toBe('DELETE'); return route.abort(); });
  // Snapshot the fixture before routing. Fetching inside the route leaves an
  // unnecessary in-flight API response that can outlive WebKit test teardown.
  const abandonedBookings = { ...bookings,
    orders: bookings.orders.filter(item => item.id !== fixture.ids.order),
    entries: bookings.entries.filter(item => item.id !== fixture.ids.order),
    total: bookings.total - 1 };
  await page.route('**/api/customer/bookings?**', route => route.fulfill({ json: { data: abandonedBookings } }));
  return () => booking;
}

test('abandoned sandbox checkout stays out of Booked and resumes from Notifications without local storage, including close and refresh', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  const booking = await abandonedCheckoutFixture(page, fixture);
  const resumes = [], prepares = [];
  await page.route('**/api/customer/payment-checkouts', route => { prepares.push(route.request().postData()); return route.abort(); });
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/resume`, route => {
    resumes.push(route.request().method());
    return route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', verificationStatus: 'pending', clientSecret: 'fixture_original_secret', stripeAccountId: 'acct_fixture', booking: booking() } } });
  });
  await page.goto('/?tab=booked');
  const saved = () => page.evaluate(() => localStorage.getItem(`nitewide.checkout.${JSON.parse(localStorage.getItem('nitewide.session')).user.id}`));
  expect(await saved()).toBeNull();
  await expect(page.getByRole('button', { name: /^Resume checkout for / })).toHaveCount(0);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.getByRole('button', { name: /Continue your purchase for/ }).click();
  const details = page.getByTestId('customer-event-details');
  await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
  const first = JSON.parse(await saved());
  expect(first.orderId).toBe(fixture.ids.order);
  expect(first.body.idempotencyKey).toBe('abandoned-original-key');
  expect(first.bookingTotals.total).toBe(booking().totalCents);
  expect(await saved()).not.toContain('fixture_original_secret');
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(details).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Resume checkout for / })).toHaveCount(0);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.getByRole('button', { name: /Continue your purchase for/ }).click();
  await expect(details.getByRole('button', { name: 'Cancel payment attempt' })).toBeVisible();
  await page.reload();
  await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
  expect(JSON.parse(await saved()).body.idempotencyKey).toBe(first.body.idempotencyKey);
  expect(prepares).toEqual([]);
  expect(resumes.length).toBeGreaterThanOrEqual(3);
  expect(resumes.every(method => method === 'POST')).toBeTruthy();
  await expectNoOverflow(page);
});

test('abandoned sandbox checkout reconciles already-paid orders and expires unpaid orders without a second payment', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  const booking = await abandonedCheckoutFixture(page, fixture);
  let status = 'cancelled', prepares = 0;
  await page.route('**/api/customer/payment-checkouts', route => { prepares += 1; return route.abort(); });
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/resume`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status, booking: booking() } } }));
  await page.goto('/?tab=booked');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.getByRole('button', { name: /Continue your purchase for/ }).click();
  await expect(page.getByRole('alert')).toContainText('checkout has ended');
  await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem(`nitewide.checkout.${JSON.parse(localStorage.getItem('nitewide.session')).user.id}`))).toBeNull();
  status = 'paid';
  await page.getByRole('button', { name: /Continue your purchase for/ }).click();
  await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${fixture.ids.order}`));
  await expect(page.getByRole('img', { name: /QR code for ticket 1/ })).toBeVisible();
  expect(prepares).toBe(0);
  await expectNoOverflow(page);
});

for (const status of ['cancelled', 'refunded']) test(`ended sandbox checkout (${status}) does not strand payment continuation after reload`, async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  const booking = (await abandonedCheckoutFixture(page, fixture))();
  await page.evaluate(({ orderId, booking }) => {
    const buyerId = JSON.parse(localStorage.getItem('nitewide.session')).user.id;
    localStorage.setItem(`nitewide.checkout.${buyerId}`, JSON.stringify({ buyerId, orderId, mode: 'stripe',
      body: { eventId: booking.event.id, idempotencyKey: booking.idempotencyKey, items: booking.items.map(item => ({ offeringId: item.offeringId, quantity: item.quantity })), expectedTotalCents: booking.totalCents } }));
  }, { orderId: fixture.ids.order, booking });
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/resume`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status, booking } } }));
  const prepares = [];
  await page.route('**/api/customer/checkout-attempts/*', route => route.fulfill({ status: 404, json: { error: { message: 'Absent' } } }));
  await page.route('**/api/customer/payment-checkouts', route => {
    prepares.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', clientSecret: 'fixture_new_secret', stripeAccountId: 'acct_fixture' } } });
  });
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  const saved = () => page.evaluate(() => localStorage.getItem(`nitewide.checkout.${JSON.parse(localStorage.getItem('nitewide.session')).user.id}`));
  await expect.poll(saved).toBeNull();
  await expect(details.getByRole('button', { name: 'Resume checkout', exact: true })).toHaveCount(0);
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  await expect(details.getByRole('button', { name: 'Continue to payment', exact: true })).toBeEnabled();
  await details.getByRole('button', { name: 'Continue to payment', exact: true }).click();
  await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
  expect(prepares).toHaveLength(1);
  expect(prepares[0].idempotencyKey).not.toBe(booking.idempotencyKey);
  expect(JSON.parse(await saved()).body.idempotencyKey).toBe(prepares[0].idempotencyKey);
  await expectNoOverflow(page);
});

test('Continue retires an ended saved sandbox checkout in one click without silently resubmitting', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await abandonedCheckoutFixture(page, fixture);
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await expect(details.getByRole('button', { name: /^Continue ·/ })).toBeEnabled();
  await page.evaluate(({ orderId, eventId, offeringId }) => {
    const buyerId = JSON.parse(localStorage.getItem('nitewide.session')).user.id;
    localStorage.setItem(`nitewide.checkout.${buyerId}`, JSON.stringify({ buyerId, orderId, mode: 'stripe',
      body: { eventId, idempotencyKey: 'ended-original-key', items: [{ offeringId, quantity: 1 }] } }));
  }, { orderId: fixture.ids.order, eventId: fixture.ids.event, offeringId: fixture.ids.offering });
  let prepares = 0;
  await page.route('**/api/customer/payment-checkouts', route => { prepares += 1; return route.abort(); });
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/resume`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'cancelled' } } }));
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  await expect(details.getByRole('alert')).toContainText('checkout has ended');
  await expect(details.getByRole('button', { name: 'Continue to payment', exact: true })).toBeEnabled();
  await expect(details.getByRole('button', { name: 'Check / retry booking', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem(`nitewide.checkout.${JSON.parse(localStorage.getItem('nitewide.session')).user.id}`))).toBeNull();
  expect(prepares).toBe(0);
  await expectNoOverflow(page);
});

test('secure checkout hides Pay while Stripe loads without blocking safe recovery', async ({ page, fixture }) => {
  let releaseStripe;
  const stripeGate = new Promise(resolve => { releaseStripe = resolve; });
  await page.route('https://js.stripe.com/**', async route => { await stripeGate; await route.abort(); });
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: true, configured: true, mode: 'test', publishableKey: 'pk_test_fixture_offline', demoEnabled: false } } }));
  try {
    await login(page, fixture, 'customer');
    await page.goto(`/?event=${fixture.ids.event}`);
    const details = page.getByTestId('customer-event-details');
    await details.getByRole('button', { name: /VIP Package/ }).click();
    await details.getByRole('button', { name: /^Continue ·/ }).click();
    await page.route('**/api/customer/checkout-attempts/*', route => route.fulfill({ status: 404, json: { error: { message: 'Absent' } } }));
    await page.route('**/api/customer/payment-checkouts', route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', clientSecret: 'fixture_checkout_secret', stripeAccountId: 'acct_fixture' } } }));
    const stripeRequested = page.waitForRequest('https://js.stripe.com/**');
    await details.getByRole('button', { name: 'Continue to payment' }).click();
    await stripeRequested;
    await expect(details.locator('.stripe-payment-form')).toBeVisible();
    await expect(details.getByRole('status').filter({ hasText: 'Loading secure payment form…' })).toBeVisible();
    await expect(details.getByRole('button', { name: /^Pay / })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Cancel payment attempt' })).toBeEnabled();
    await expectNoOverflow(page);
    releaseStripe();
    // The error-state action can check an already-paid booking without
    // attempting a new confirmation through an unavailable provider.
    await expect(details.getByRole('alert').filter({ hasText: 'payment form couldn’t load' })).toBeVisible();
    await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
    await expect(details.getByRole('status').filter({ hasText: 'Loading secure payment form…' })).toHaveCount(0);
  } finally { releaseStripe(); }
});

test('sandbox checkout cancellation retires its key only after server confirms cancellation', async ({ page, fixture }) => {
  await page.route('https://js.stripe.com/**', route => route.abort());
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: true, configured: true, mode: 'test', publishableKey: 'pk_test_fixture_offline', demoEnabled: false } } }));
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  await page.route('**/api/customer/checkout-attempts/*', route => route.fulfill({ status: 404, json: { error: { message: 'Absent' } } }));
  await page.route('**/api/customer/payment-checkouts', route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', clientSecret: 'fixture_checkout_secret', stripeAccountId: 'acct_fixture' } } }));
  let cancellation = 'pending';
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/cancel`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: cancellation } } }));
  await details.getByRole('button', { name: 'Continue to payment' }).click();
  await details.getByRole('button', { name: 'Cancel payment attempt' }).click();
  await expect(details.getByRole('alert').filter({ hasText: 'still being checked' })).toBeVisible();
  const pending = () => page.evaluate(() => localStorage.getItem(`nitewide.checkout.${JSON.parse(localStorage.getItem('nitewide.session')).user.id}`));
  expect(await pending()).toBeTruthy();
  cancellation = 'cancelled';
  await details.getByRole('button', { name: 'Cancel payment attempt' }).click();
  await expect(details.getByRole('button', { name: /^Continue ·/ })).toBeVisible();
  expect(await pending()).toBeNull();
  await expectNoOverflow(page);
});

test('definitive checkout rejection allows a reviewed new cart with a new key', async ({ page, fixture }) => {
  await login(page, fixture, 'customer');
  await page.goto(`/?event=${fixture.ids.event}`);
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  const keys = [];
  let orderId;
  await page.route('**/api/orders', async route => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (keys.length === 1) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'PRICE_CHANGED', message: 'Pricing changed.' } }) });
    const response = await route.fetch();
    orderId = (await response.json()).data.order.id;
    await route.fulfill({ response });
  });
  await details.getByRole('button', { name: 'Confirm demo booking', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('Booking was not completed');
  await details.getByRole('button', { name: 'Back to tickets & tables' }).click();
  await details.getByRole('button', { name: 'Increase quantity' }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  await details.getByRole('button', { name: 'Confirm demo booking', exact: true }).click();
  await expect.poll(() => orderId).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${orderId}`));
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
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
  await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${orderId}`));
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
