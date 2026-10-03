const { test: baseTest, expect, login, expectNoOverflow } = require('../fixtures.cjs');
const test = baseTest.extend({ fixtureRecipe: 'business-access' });
const customerAuthTest = baseTest.extend({ fixtureRecipe: 'customer-auth' });
const adminAccessTest = baseTest.extend({ fixtureRecipe: 'admin-access' });
const businessAuthTest = baseTest.extend({ fixtureRecipe: 'business-auth' });
const { urls, controlToken } = require('../environment.cjs');

const sessionKey = 'nitewide.business.session';
const denied = { error: { code: 'BUSINESS_ACCESS_REQUIRED', message: 'Business access requires approval and completed onboarding.' } };
async function identity(request, fixture, role = 'customer') {
  const response = await request.post(`${urls.api}/api/auth/sign-in`, { data: { email: fixture.accounts[role].email, password: fixture.password } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).data;
}
async function signIn(page, fixture, role = 'customer') {
  await page.getByLabel('Work email', { exact: true }).fill(fixture.accounts[role].email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  const result = page.waitForResponse(response => response.url().endsWith('/api/auth/business/sign-in') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in to Nitewide', exact: true }).click();
  return result;
}
async function fillRequest(page, email, role = 'owner') {
  await page.getByLabel('Full name', { exact: true }).fill('Playwright Organizer');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Phone number', { exact: true }).fill('(407) 555-0199');
  await page.getByLabel('Business name', { exact: true }).fill('Playwright Access Nights');
  await page.getByLabel('Your role', { exact: true }).selectOption(role);
  await page.getByRole('textbox', { name: 'Tell us about your business', exact: true }).fill('We host local music events and would like one business workspace.');
}
async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name.endsWith('iphone') ? { width: 390, height: 844 } : { width: 1440, height: 900 });
});

customerAuthTest('customer credentials are denied Business access and offer a visible request action', async ({ page, request, fixture }, testInfo) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Request access', exact: true })).toBeVisible();
  expect((await signIn(page, fixture)).status()).toBe(403);
  await expect(page.getByRole('alert')).toContainText(/Business access|business access/);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key), sessionKey)).toBeNull();
  expect((await request.post(`${urls.api}/api/auth/sign-in`, { data: { email: fixture.accounts.customer.email, password: fixture.password } })).status()).toBe(200);
  await expectNoOverflow(page); await screenshot(page, testInfo, 'business-customer-denied');
});

adminAccessTest('public access request journey preserves failed drafts, prevents duplicates and grants no access after decline', async ({ page, request, fixture }, testInfo) => {
  const admin = await identity(request, fixture, 'admin');
  const headers = { Authorization: `Bearer ${admin.accessToken}` };
  const posts = [];
  page.on('request', event => { if (event.url().endsWith('/api/business/access-requests') && event.method() === 'POST') posts.push(event); });
  let attempts = 0, finish;
  const waiting = new Promise(done => { finish = done; });
  await page.route('**/api/business/access-requests', async route => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: { message: 'Request service is temporarily unavailable. Try again.' } } });
    await waiting;
    return route.continue();
  });
  await test.step('The public form has accessible targets and preserves its draft after a service failure', async () => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Request access', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Request access.', exact: true })).toBeFocused();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Request Business access' })).toContainText('10–2,000 characters');
    await fillRequest(page, fixture.accounts.customer.email, 'manager');
    await expectNoOverflow(page); await screenshot(page, testInfo, 'business-access-request-form');
    const touchTargets = await page.locator('#business-access-request-form input, #business-access-request-form select, #business-access-request-form textarea, #business-access-request-form button').evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().height)));
    expect(touchTargets.every(height => height >= 44)).toBeTruthy();
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Playwright Access Nights');
    await expect(page.getByLabel('Your role', { exact: true })).toHaveValue('manager');
    expect(await page.evaluate(key => sessionStorage.getItem(key), sessionKey)).toBeNull();
  });
  await test.step('Explicit retry locks submission and sends one successful request without auth or password fields', async () => {
    await page.getByLabel('Your role', { exact: true }).selectOption('owner');
    const sent = page.waitForResponse(response => response.url().endsWith('/api/business/access-requests') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sending request…', exact: true })).toBeDisabled();
    await page.locator('#business-access-request-form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(attempts).toBe(2);
    finish();
    expect((await sent).status()).toBe(202);
    await expect(page.getByRole('heading', { name: 'Request received.', exact: true })).toBeFocused();
    await expect(page.getByRole('status')).toContainText('Access is not granted until onboarding is completed.');
    expect(posts).toHaveLength(2);
    expect(attempts).toBe(2);
    for (const post of posts) {
      expect(Object.keys(post.postDataJSON()).sort()).toEqual(['businessName', 'details', 'displayName', 'email', 'phone', 'role']);
      expect(post.headers().authorization).toBeUndefined();
    }
    expect(await page.evaluate(key => sessionStorage.getItem(key), sessionKey)).toBeNull();
    await expectNoOverflow(page); await screenshot(page, testInfo, 'business-access-request-received');
  });
  await test.step('The real API deduplicates the pending request, normalizes its phone and still denies declined access', async () => {
    const submission = posts[1].postDataJSON();
    expect((await request.post(`${urls.api}/api/business/access-requests`, { data: submission })).status()).toBe(202);
    const queueResponse = await request.get(`${urls.api}/api/admin/business-access/requests?search=${encodeURIComponent(submission.email)}`, { headers });
    expect(queueResponse.ok()).toBeTruthy();
    const queue = (await queueResponse.json()).data;
    expect(queue.total).toBe(1);
    expect(queue.items[0].status).toBe('pending');
    expect(queue.items[0].phone).toBe('+14075550199');
    await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Request access', exact: true })).toBeFocused();
    expect((await signIn(page, fixture)).status()).toBe(403);
    const row = queue.items[0];
    expect((await request.post(`${urls.api}/api/admin/business-access/requests/${row.id}/decline`, { headers, data: { version: row.version, reason: 'Isolated browser test decline' } })).ok()).toBeTruthy();
    expect((await signIn(page, fixture)).status()).toBe(403);
    expect(await page.evaluate(key => sessionStorage.getItem(key), sessionKey)).toBeNull();
    const emails = await request.get(`${urls.api}/__e2e/emails`, { headers: { 'x-e2e-control': controlToken } });
    expect(await emails.json()).toEqual([]);
  });
});

customerAuthTest('a copied customer token is checked before any workspace navigation renders and generic customer auth remains valid', async ({ page, request, fixture }) => {
  const customer = await identity(request, fixture);
  let release;
  const waiting = new Promise(done => { release = done; });
  await page.addInitScript(({ key, value }) => {
    sessionStorage.setItem(key, JSON.stringify(value)); window.__protectedWorkspaceAppeared = false;
    new MutationObserver(() => { if (document.querySelector('.app-shell')) window.__protectedWorkspaceAppeared = true; }).observe(document, { childList: true, subtree: true });
  }, { key: sessionKey, value: customer });
  await page.route('**/api/business/bootstrap', async route => { await waiting; return route.continue(); });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Checking your Business access.', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0); release();
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('does not have active Business access');
  expect(await page.evaluate(() => window.__protectedWorkspaceAppeared)).toBe(false);
  expect(await page.evaluate(key => sessionStorage.getItem(key), sessionKey)).toBeNull();
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${customer.accessToken}` } })).status()).toBe(200);
  await expectNoOverflow(page);
});

businessAuthTest('bootstrap failures hide protected data, retry safely and return to sign in without revoking identity', async ({ page, request, fixture }) => {
  const business = await identity(request, fixture, 'business');
  let unavailable = true;
  await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: sessionKey, value: business });
  await page.route('**/api/business/bootstrap', route => unavailable ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Workspace is temporarily unavailable.' } }) }) : route.continue());
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'We couldn’t open your workspace.', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  unavailable = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('navigation').filter({ visible: true }).getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  unavailable = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'We couldn’t open your workspace.', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request access', exact: true })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), sessionKey)).toBeNull();
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${business.accessToken}` } })).status()).toBe(200);
});

businessAuthTest('report scope denials keep the approved session, but focus refresh access revocation clears the workspace', async ({ page, fixture }) => {
  await page.route('**/api/business/reports/summary?**', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'You do not have report access for this scope.' } }) }));
  await login(page, fixture, 'business');
  await expect(page.getByRole('alert')).toContainText('report access');
  expect(await page.evaluate(key => Boolean(sessionStorage.getItem(key)), sessionKey)).toBe(true);
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.route('**/api/business/bootstrap', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify(denied) }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Request access', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key), sessionKey)).toBeNull();
});

customerAuthTest('an existing customer signs into an onboarding invitation using identity auth and returns to accept access before entering Business', async ({ page, fixture }) => {
  const token = 'synthetic-existing-account-onboarding-token';
  const protectedRequests = [];
  page.on('request', request => { if (request.url().includes('/api/business/')) protectedRequests.push(request.url()); });
  await page.route('**/api/auth/onboarding/preview?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: {
    email: fixture.accounts.customer.email, displayName: fixture.accounts.customer.name, accountMode: 'existing', kind: 'organization', expiresAt: new Date(Date.now() + 3600000).toISOString(),
  } }) }));
  await page.goto(`/app?onboarding=${token}`);
  await page.getByRole('button', { name: 'Sign in to continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request access', exact: true })).toHaveCount(0);
  await page.getByLabel('Work email', { exact: true }).fill(fixture.accounts.customer.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  const authentication = page.waitForResponse(response => response.url().endsWith('/api/auth/sign-in') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in to Nitewide', exact: true }).click();
  expect((await authentication).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Accept access', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(protectedRequests).toEqual([]);
  await expect(page).toHaveURL(new RegExp(`onboarding=${token}`));
  await expectNoOverflow(page);
});
