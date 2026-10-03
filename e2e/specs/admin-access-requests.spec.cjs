const { test, expect, login, expectNoOverflow } = require('../fixtures.cjs');
const adminAccessTest = test.extend({ fixtureRecipe: 'admin-access' });
const { urls } = require('../environment.cjs');

const uuid = number => `60000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const rootPath = '/admin/business-access/requests';

async function captureReviewScreenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

// All review responses are local mocks: these tests never invoke onboarding or
// an email provider. They assert UI/payload semantics, not simulated delivery.
async function mockReviews(page, role = 'platform_owner') {
  const session = { accessToken: 'mocked-review-session', roles: ['internal_admin'], user: { id: uuid(100), displayName: 'Review Staff', email: 'staff@example.test', isInternalAdmin: true, internalAdminRole: role, isActive: true, lifecycleState: 'active' } };
  await page.addInitScript(value => sessionStorage.setItem('nitewide.admin.session', JSON.stringify(value)), session);
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: uuid(index + 1), displayName: `Contact ${index + 1}`, email: `contact${index + 1}@example.test`, phone: '+14075550199', businessName: `Requested Business ${String(index + 1).padStart(2, '0')}`, role: 'manager', details: `Organizer requesting a reviewed business workspace ${index + 1}.`, status: index < 27 ? 'pending' : index < 29 ? 'approved' : 'declined', version: 2, createdAt: '2026-09-20T12:00:00Z', updatedAt: '2026-09-20T12:00:00Z', reviewedAt: index < 27 ? null : '2026-09-21T12:00:00Z', reviewReason: index < 27 ? null : 'Verified prior review' }));
  const state = { requests: [], rows, approvalFailures: [], declineFailures: [], readFailures: [] };
  const paged = (items, params) => { const page = Number(params.get('page') || 1), pageSize = Number(params.get('pageSize') || 25); return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, hasMore: page * pageSize < items.length }; };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api', ''), method = request.method();
    const body = method === 'POST' ? request.postDataJSON() : null;
    state.requests.push({ path, method, body, query: url.search });
    const response = (status, value) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { data: value } : { error: { message: value } }) });
    if (path === '/auth/me') return response(200, session);
    if (path === '/admin/management/resources') return response(200, [{ key: 'organizations', label: 'Businesses', fields: [], editFields: [], canCreate: false, actions: [] }]);
    if (path === '/admin/management/organizations') return response(200, paged([], url.searchParams));
    if (path === '/admin/reports/summary') return response(200, { summary: { orders: 0 }, daily: [] });
    if (path === '/admin/overview/needs-attention') return response(200, paged([{ id: `access-${rows[0].id}`, kind: 'business_access_request', recordType: 'business_access_request', recordId: rows[0].id, title: rows[0].businessName, priority: 'normal', createdAt: rows[0].createdAt }], url.searchParams));
    if (path.startsWith(rootPath)) {
      const [, id, action] = path.slice(rootPath.length).split('/'); const row = rows.find(item => item.id === id);
      if (method === 'GET' && state.readFailures.length) return response(state.readFailures.shift(), 'Requests could not be loaded. Try again.');
      if (method === 'POST') {
        if (role !== 'platform_owner') return response(403, 'Your staff role cannot review requests.');
        const failures = action === 'approve' ? state.approvalFailures : state.declineFailures;
        const failure = failures.shift();
        if (failure === 503) return response(503, 'The onboarding email could not be queued. The request is still pending; try again when email delivery is available.');
        if (failure === 409) { row.version = 7; return response(409, 'This request was already reviewed or changed. Refresh before continuing.'); }
        if (row.status !== 'pending' || row.version !== body.version) return response(409, 'This request was already reviewed or changed. Refresh before continuing.');
        if (action === 'approve' && body.recipient.email !== row.email) return response(409, 'Use the email submitted with this request.');
        Object.assign(row, { status: action === 'approve' ? 'approved' : 'declined', version: row.version + 1, reviewedAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', reviewReason: body.reason, reviewedByUserId: session.user.id });
        if (action === 'approve') Object.assign(row, { organizationId: uuid(200), onboardingInvitationId: uuid(201) });
        return response(200, { request: row, ...(action === 'approve' ? { invitation: { id: uuid(201), organizationId: uuid(200), delivery: 'queued' } } : {}) });
      }
      if (id) return row ? response(200, row) : response(404, 'Access request not found.');
      const statuses = url.searchParams.getAll('statuses'), search = (url.searchParams.get('search') || '').toLowerCase();
      return response(200, paged(rows.filter(item => (!statuses.length || statuses.includes(item.status)) && `${item.businessName} ${item.displayName} ${item.email} ${item.phone}`.toLowerCase().includes(search)), url.searchParams));
    }
    return response(404, 'This test does not provide that record.');
  });
  return state;
}

async function openApproval(page, id = uuid(1)) {
  await page.goto(`/?section=businesses&businessView=requests&request=${id}`);
  await page.getByRole('button', { name: 'Review for approval', exact: true }).click();
  return page.getByRole('dialog', { name: 'Approve business access request', exact: true });
}
async function reviewDraft(dialog) {
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByLabel('I have confirmed the contact’s authority to represent this business.').check();
  await dialog.getByLabel('Required audit reason').fill('Verified business representative and authority');
}

test('access request recovery, filters and reviewed details preserve independent directory context', async ({ page }, testInfo) => {
  const state = await mockReviews(page);
  state.readFailures.push(503);
  await page.goto('/?section=businesses&search=ExistingBusiness&page=3');
  await page.getByRole('tab', { name: 'Access requests', exact: true }).click();
  await test.step('failed list reads retry safely and retain pending defaults and reachable review targets', async () => {
    await expect(page.getByRole('alert')).toContainText('Requests could not be loaded'); await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText('27 access requests', { exact: true })).toBeVisible();
    const review = page.getByTestId('access-request').first().getByRole('button', { name: 'Review request' }); const bounds = await review.boundingBox(); expect(bounds.height).toBeGreaterThanOrEqual(44); expect(bounds.width).toBeGreaterThanOrEqual(44);
    await captureReviewScreenshot(page, testInfo, 'requests-list');
    expect(new URLSearchParams(state.requests.find(item => item.path === rootPath).query).getAll('statuses')).toEqual(['pending']);
  });
  await test.step('a paged request returns to its original request-list page', async () => {
    await page.getByRole('button', { name: 'Next', exact: true }).click(); await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await page.getByTestId('access-request').first().getByRole('button', { name: 'Review request' }).click();
    await expect(page.getByRole('heading', { name: 'Requested Business 26', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to access requests' }).click(); await expect(page.getByText('Page 2 of 2')).toBeVisible();
  });
  await test.step('explicit search resets pagination and statuses support multiple choices', async () => {
    const before = state.requests.filter(item => item.path === rootPath).length;
    await page.getByRole('textbox', { name: 'Search access requests', exact: true }).fill('contact27@example.test');
    expect(state.requests.filter(item => item.path === rootPath)).toHaveLength(before);
    await page.getByRole('button', { name: 'Search', exact: true }).click(); await expect(page.getByText('1 access request', { exact: true })).toBeVisible(); await expect(page.getByText('Page 1 of 1')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search access requests', exact: true }).fill(''); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Request status', exact: true }).click(); await page.getByRole('checkbox', { name: 'Approved', exact: true }).check(); await page.keyboard.press('Escape');
    await expect(page.getByText('29 access requests', { exact: true })).toBeVisible();
    const latest = state.requests.filter(item => item.path === rootPath).at(-1); expect(new URLSearchParams(latest.query).getAll('statuses')).toEqual(['pending', 'approved']);
  });
  await test.step('previously approved requests cannot be approved or declined again', async () => {
    await page.getByRole('button', { name: 'Next', exact: true }).click(); await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await page.getByTestId('access-request').filter({ has: page.getByRole('heading', { name: 'Requested Business 28', exact: true }) }).getByRole('button', { name: 'Review request', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Requested Business 28', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review for approval', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Decline request', exact: true })).toHaveCount(0); await expect(page.getByText(/Active access still requires/)).toBeVisible(); await expectNoOverflow(page);
    await page.getByRole('button', { name: 'Back to access requests' }).click(); await expect(page.getByText('Page 2 of 2')).toBeVisible();
  });
  await test.step('Businesses restores its separate search and pagination', async () => {
    await page.getByRole('tab', { name: 'Businesses', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search businesses', exact: true })).toHaveValue('ExistingBusiness');
    expect(new URL(page.url()).searchParams.get('page')).toBe('3'); await expectNoOverflow(page);
  });
});


test('decline requires an audit reason and explicit stale refresh while retaining history', async ({ page }) => {
  const state = await mockReviews(page); state.declineFailures.push(409); await page.goto(`/?section=businesses&businessView=requests&request=${uuid(1)}`);
  await page.getByRole('button', { name: 'Decline request', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Decline access request' });
  await expect(dialog.getByRole('button', { name: 'Decline request', exact: true })).toBeDisabled(); await dialog.getByLabel('Required audit reason').fill('Verified duplicate access request');
  await dialog.getByRole('button', { name: 'Decline request', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Refresh before continuing');
  await expect(dialog.getByLabel('Required audit reason')).toHaveValue('Verified duplicate access request'); await expect(dialog.getByRole('button', { name: 'Decline request', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Refresh request version' }).click(); await expect(dialog.getByText(/Request version refreshed/)).toBeVisible();
  expect(state.requests.filter(item => item.path.endsWith('/decline'))).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Decline request', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Review history', exact: true })).toBeVisible(); await expect(page.getByText('Verified duplicate access request', { exact: true })).toBeVisible();
  expect(state.requests.filter(item => item.path.endsWith('/decline')).map(item => item.body)).toEqual([{ version: 2, reason: 'Verified duplicate access request' }, { version: 7, reason: 'Verified duplicate access request' }]);
  expect(state.requests.filter(item => item.path.endsWith('/approve'))).toHaveLength(0); await expectNoOverflow(page);
});

for (const role of ['read_only', 'support', 'operations']) test(`${role} staff can review submitted details but cannot approve or decline`, async ({ page }) => {
  const state = await mockReviews(page, role); await page.goto('/?section=businesses&businessView=requests');
  await page.getByTestId('access-request').first().getByRole('button', { name: 'Review request' }).click();
  await expect(page.getByRole('heading', { name: 'Requested Business 01', exact: true })).toBeVisible(); await expect(page.getByText('contact1@example.test', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review for approval', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Decline request', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Only authorized platform administrators/)).toBeVisible(); expect(state.requests.every(item => item.method === 'GET')).toBe(true); await expectNoOverflow(page);
});

test('a request reviewed elsewhere blocks an open approval without losing the draft or retrying the grant', async ({ page }) => {
  const state = await mockReviews(page); state.approvalFailures.push(409); const dialog = await openApproval(page);
  await reviewDraft(dialog); await dialog.getByRole('button', { name: 'Approve and queue setup email' }).click(); await expect(dialog.getByRole('alert')).toBeVisible();
  Object.assign(state.rows[0], { status: 'declined', reviewedAt: '2026-10-01T12:00:00Z', reviewReason: 'Reviewed by another administrator' });
  await dialog.getByRole('button', { name: 'Refresh request version' }).click(); await expect(dialog).toContainText('This request has already been reviewed');
  await expect(dialog.getByLabel('Required audit reason')).toHaveValue('Verified business representative and authority'); await expect(dialog.getByRole('button', { name: 'Approve and queue setup email' })).toBeDisabled();
  expect(state.requests.filter(item => item.path.endsWith('/approve'))).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Review history', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Review for approval', exact: true })).toHaveCount(0); await expectNoOverflow(page);
});

adminAccessTest('real API Admin approval queues secure onboarding but grants no customer membership before acceptance', async ({ page, request, fixture }, testInfo) => {
  // No browser routes are mocked in this case. The disposable harness replaces
  // only the external email boundary; auth, review, transactions and data are real.
  const contact = fixture.accounts.customer;
  const submitted = await request.post(`${urls.api}/api/business/access-requests`, { data: { displayName: contact.name, email: contact.email, phone: '(407) 555-0199', businessName: 'Playwright Reviewed Business', role: 'owner', details: 'We organize local events and need a reviewed business workspace.' } });
  expect(submitted.status()).toBe(202);
  await login(page, fixture, 'admin');
  await test.step('Needs attention opens the exact real submitted request', async () => {
    const attention = page.locator('.management-record').filter({ has: page.getByRole('heading', { name: 'Business access requested: Playwright Reviewed Business', exact: true }) });
    await attention.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Access requests', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Playwright Reviewed Business', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('request')).toBeTruthy();
    await captureReviewScreenshot(page, testInfo, 'request-detail');
    await expectNoOverflow(page);
  });
  await page.getByRole('button', { name: 'Review for approval', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Approve business access request', exact: true });
  await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue(contact.email); await expect(dialog.getByLabel('Email', { exact: true })).toHaveAttribute('readonly', '');
  await expect(dialog.getByLabel('Initial business role')).toHaveValue('owner');
  await dialog.getByLabel('Initial business role').selectOption('manager');
  await dialog.getByLabel('Grant separate finance permission').check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByLabel('Description (optional)')).toHaveValue('We organize local events and need a reviewed business workspace.');
  await expect(dialog.getByLabel('Public slug')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).toContainText('No saved venues');
  await expect(dialog).toContainText('Manager with finance permission');
  await dialog.getByLabel('Required audit reason').fill('Verified business representative and authority');
  const approvalAttempts = [];
  const observeApproval = request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/approve')) approvalAttempts.push(request); };
  page.on('request', observeApproval);
  await dialog.getByRole('button', { name: 'Approve and queue setup email' }).click();
  expect(approvalAttempts).toHaveLength(0);
  await dialog.getByLabel('I have confirmed the contact’s authority to represent this business.').check();
  const approval = page.waitForResponse(response => response.url().includes(`${rootPath}/`) && response.url().endsWith('/approve') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Approve and queue setup email' }).click(); const response = await approval;
  expect(approvalAttempts).toHaveLength(1);
  page.off('request', observeApproval);
  expect(response.request().postDataJSON()).toMatchObject({ kind: 'organization', recipient: { email: contact.email, role: 'manager', financeAuthorized: true }, organization: { name: 'Playwright Reviewed Business' }, confirmedAuthority: true, venues: [] });
  expect(JSON.stringify(response.request().postDataJSON())).not.toContain('password');
  expect(response.status()).toBe(200); const data = (await response.json()).data;
  expect(new URL(page.url()).searchParams.get('request')).toBe(data.request.id);
  expect(data.request.status).toBe('approved'); expect(data.invitation.delivery).toBe('queued'); expect(data.invitation.accountMode).toBe('existing');
  expect(data.invitation).toMatchObject({ role: 'manager', financeAuthorized: true });
  expect(JSON.stringify(data)).not.toMatch(/tokenHash|passwordHash|passwordSalt/);
  await expect(dialog).toContainText('Delivery is not yet confirmed.'); await expect(dialog).toContainText('Active business access still requires');
  await expect(dialog).toContainText('Ownership has not been granted.');
  await captureReviewScreenshot(page, testInfo, 'real-api-approved');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Review history', exact: true })).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nitewide.admin.session'))); const headers = { Authorization: `Bearer ${session.accessToken}` };
  const reviewed = await request.get(`${urls.api}/api${rootPath}/${data.request.id}`, { headers }); expect(reviewed.ok()).toBeTruthy(); expect((await reviewed.json()).data.status).toBe('approved');
  const ownershipResponse = await request.get(`${urls.api}/api/admin/businesses/${data.request.organizationId}/ownership`, { headers }); expect(ownershipResponse.ok()).toBeTruthy();
  const ownership = (await ownershipResponse.json()).data; expect(ownership.owners).toEqual([]); expect(ownership.managers).toEqual([]); expect(ownership.onboardingEstablished).toBe(false); expect(ownership.invitations.some(item => item.id === data.request.onboardingInvitationId && !item.acceptedAt)).toBe(true);
  for (const resource of ['employees', 'organization_affiliates']) {
    const memberships = await request.get(`${urls.api}/api/admin/management/${resource}?organizationId=${data.request.organizationId}`, { headers }); expect(memberships.ok()).toBeTruthy(); expect((await memberships.json()).data.total).toBe(0);
  }
  const denied = await request.post(`${urls.api}/api/auth/business/sign-in`, { data: { email: contact.email, password: fixture.password } }); expect(denied.status()).toBe(403); expect((await denied.json()).error.code).toBe('BUSINESS_ACCESS_REQUIRED');
  const customer = await request.post(`${urls.api}/api/auth/sign-in`, { data: { email: contact.email, password: fixture.password } }); expect(customer.status()).toBe(200);
  const customerHeaders = { Authorization: `Bearer ${(await customer.json()).data.accessToken}` };
  expect((await request.get(`${urls.api}/api/business/bootstrap`, { headers: customerHeaders })).status()).toBe(403);
  expect((await request.get(`${urls.api}/api/customer/bookings`, { headers: customerHeaders })).status()).toBe(200); await expectNoOverflow(page);
});
