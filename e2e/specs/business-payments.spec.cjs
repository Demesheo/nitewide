const { test, expect, login, expectNoOverflow } = require('../fixtures.cjs');

test('business payment profiles support named defaults, hosted setup and verified readiness', async ({ page, fixture }) => {
  await page.route('**/api/business/bootstrap', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.organizations = payload.data.organizations.map(item => ({ ...item, canManageFinance: true }));
    await route.fulfill({ response, json: payload });
  });
  const accounts = [{ id: '00000000-0000-4000-8000-000000000501', name: 'Downtown', paymentsReady: false, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false }];
  let defaultPaymentAccountId = null;
  const creates = [];
  let onboarded = false;
  await page.route('**/api/business/organizations/*/payment-accounts**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/onboarding')) { onboarded = true; return route.fulfill({ json: { data: { url: 'https://connect.stripe.com/setup/offline-fixture', expiresAt: new Date().toISOString() } } }); }
    if (path.endsWith('/synchronize')) { accounts[0] = { ...accounts[0], paymentsReady: true, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true }; return route.fulfill({ json: { data: accounts[0] } }); }
    if (path.endsWith('/default')) { defaultPaymentAccountId = route.request().postDataJSON().paymentAccountId; return route.fulfill({ json: { data: {} } }); }
    if (method === 'POST') { creates.push(route.request().postDataJSON()); accounts.push({ id: '00000000-0000-4000-8000-000000000502', name: creates[0].name, paymentsReady: false }); return route.fulfill({ json: { data: accounts[1] } }); }
    return route.fulfill({ json: { data: { items: accounts, total: accounts.length, page: 1, pageSize: 10, hasMore: false, defaultPaymentAccountId } } });
  });
  await login(page, fixture, 'business', 'business', `/app?section=team&teamOrganizationId=${fixture.ids.org}`);
  const card = page.locator('.payment-accounts').first();
  await expect(page.locator('.payment-accounts')).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Payment accounts' })).toBeVisible();
  await expect(card.getByText('Setup required', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Check readiness' }).click();
  await expect(card.getByText('Ready for sandbox payments')).toBeVisible();
  await card.getByLabel('Default payment account').selectOption(accounts[0].id);
  await expect.poll(() => defaultPaymentAccountId).toBe(accounts[0].id);
  await card.getByLabel('New account name').fill('Uptown');
  await card.getByRole('button', { name: 'Add payment account' }).click();
  await expect(card.getByRole('heading', { name: 'Uptown' })).toBeVisible();
  await expect(page.locator('.payment-accounts')).toHaveCount(1);
  expect(creates).toHaveLength(1); expect(creates[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(card.getByRole('link', { name: 'Stripe dashboard' })).toHaveAttribute('href', 'https://dashboard.stripe.com/');
  await expectNoOverflow(page);
  await page.route('https://connect.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Offline hosted Stripe onboarding fixture</body></html>' }));
  await card.getByRole('button', { name: 'Complete Stripe setup' }).click();
  await expect(page).toHaveURL('https://connect.stripe.com/setup/offline-fixture');
  expect(onboarded).toBe(true);
  await page.goto(`/app?section=team&teamOrganizationId=${fixture.ids.org}&paymentAccountReturn=${accounts[0].id}&paymentOrganization=${fixture.ids.org}`);
  await expect(page.getByRole('status').filter({ hasText: 'Payment readiness checked with Stripe.' })).toBeVisible();
  await expect(page.locator('.payment-accounts')).toHaveCount(1);
  await expectNoOverflow(page);
});

test('event payment selection remains read only after paid bookings', async ({ page, fixture }) => {
  await page.route(`**/api/business/events/${fixture.ids.event}/summary`, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    Object.assign(payload.data.event, { canManageFinance: true, canChangePaymentAccount: false });
    await route.fulfill({ response, json: payload });
  });
  await page.route('**/api/business/organizations/*/payment-accounts**', route => route.fulfill({ json: { data: { items: [], total: 0, hasMore: false, defaultPaymentAccountId: null } } }));
  await login(page, fixture, 'business', 'business', `/app?section=events&event=${fixture.ids.event}`);
  const card = page.locator('.payment-accounts');
  await expect(card.getByRole('heading', { name: 'Event payments' })).toBeVisible();
  await expect(card.getByLabel('Event payment account')).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Save payment account' })).toBeDisabled();
  await expect(card.getByRole('status')).toContainText('locked');
  await expectNoOverflow(page);
});

test('manager without finance permission does not see payment profile controls', async ({ page, fixture }) => {
  await login(page, fixture, 'business', 'business', `/app?section=team&teamOrganizationId=${fixture.ids.org}`);
  await expect(page.getByRole('heading', { name: 'Build your team' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
  await expectNoOverflow(page);
});
