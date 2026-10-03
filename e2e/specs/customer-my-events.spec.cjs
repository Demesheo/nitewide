const { test, expect, login, expectNoOverflow } = require('../fixtures.cjs');
const { urls, controlToken } = require('../environment.cjs');
const { requestFiveSpots, expectFourApprovedPasses } = require('../guestlist-quantity.cjs');
const { gestureClipboard, refusedClipboard } = require('../clipboard.cjs');

async function operatorScenario(request, past = false) {
  const response = await request.post(`${urls.api}/__e2e/my-events-fixture`, {
    headers: { 'x-e2e-control': controlToken }, data: { past },
  });
  expect(response.ok(), `isolated operator scenario: ${await response.text()}`).toBeTruthy();
}

async function openMyEvent(page, fixture, role = 'business') {
  await login(page, fixture, 'customer', role);
  await page.getByRole('button', { name: 'My events', exact: true }).click();
  const search = page.getByRole('search', { name: 'Search my events' });
  await search.getByRole('searchbox', { name: 'Search your events', exact: true }).fill('Friday');
  await search.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'View Playwright Friday Night operations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Playwright Friday Night', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^(Event performance|Your performance)$/ })).toBeVisible();
}

async function sessionToken(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
}

function guestlist(page) { return page.locator('.my-event-guestlist-panel'); }
async function capture(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
async function expectSmallPhoneLayout(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoOverflow(page);
  await page.setViewportSize(viewport);
}

test('My events is hidden for customer-only accounts and its API rejects direct access', async ({ page, request, fixture }) => {
  await login(page, fixture, 'customer');
  const token = await sessionToken(page);
  await expect(page.getByRole('button', { name: 'My events', exact: true })).toHaveCount(0);
  const access = await request.get(`${urls.api}/api/customer/my-events/access`, { headers: { authorization: `Bearer ${token}` } });
  expect(await access.json()).toEqual({ data: { eligible: false } });
  const response = await request.get(`${urls.api}/api/customer/my-events`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(403);
  await page.goto('/?tab=my-events');
  await expect(page.getByRole('heading', { name: 'Your event access isn’t available.', exact: true })).toBeVisible();
  await expect(page.locator('.my-event-card')).toHaveCount(0);
  await expectNoOverflow(page);
});

test('clipboard refusal offers a selectable operator link and clears it after retry', async ({ page, context, fixture }, testInfo) => {
  await refusedClipboard(context);
  await openMyEvent(page, fixture);
  await page.getByRole('button', { name: 'Copy my referral link', exact: true }).click();
  const manual = page.getByRole('textbox', { name: 'Copy link manually', exact: true });
  await expect(manual).toBeVisible();
  await expect(manual).toHaveAttribute('readonly', '');
  const link = await manual.inputValue();
  expect(new URL(link).searchParams.get('event')).toBe(fixture.ids.event);
  await manual.click();
  await expect.poll(() => manual.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([0, link.length]);
  await expect(page.getByRole('button', { name: 'Referral link copied', exact: true })).toHaveCount(0);
  await expectNoOverflow(page);
  await capture(page, testInfo, 'customer-manual-copy-fallback');
  await page.evaluate(() => {
    navigator.clipboard.write = async items => { window.__retriedCopy = await (await items[0].getType('text/plain')).text(); };
    navigator.clipboard.writeText = async text => { window.__retriedCopy = text; };
  });
  await page.getByRole('button', { name: 'Retry copying referral link', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Referral link copied', exact: true })).toBeVisible();
  await expect(manual).toHaveCount(0);
  expect(await page.evaluate(() => window.__retriedCopy)).toBe(link);
});

test('My events uses explicit search, server pagination and clean navigation without opening checkout', async ({ page, fixture }, testInfo) => {
  const requests = [];
  page.on('request', request => { if (/\/api\/customer\/my-events\?/.test(request.url())) requests.push(request.url()); });
  await login(page, fixture, 'customer', 'business');
  await page.getByRole('button', { name: 'My events', exact: true }).click();
  await expect(page.locator('.my-event-card')).toHaveCount(12);
  const pages = page.getByRole('navigation', { name: 'My events pages', exact: true });
  await expect(pages).toContainText('Page 1 of 2');
  await expectNoOverflow(page);
  await capture(page, testInfo, 'my-events-directory');
  await expectSmallPhoneLayout(page);
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.my-event-card')).toHaveCount(2);
  await expect(pages).toContainText('Page 2 of 2');
  await expect(page).toHaveURL(/myPage=2/);
  await page.locator('.my-event-card').first().click();
  await expect(page.getByRole('heading', { name: 'Event performance', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('event')).toBe(false);
  await page.goBack();
  await expect(pages).toContainText('Page 2 of 2');
  const count = requests.length;
  const search = page.getByRole('search', { name: 'Search my events' });
  await search.getByRole('searchbox', { name: 'Search your events', exact: true }).fill('Friday');
  expect(requests).toHaveLength(count);
  await search.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.my-event-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'View Playwright Friday Night operations' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('mySearch')).toBe('Friday');
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  const params = new URL(page.url()).searchParams;
  for (const key of ['myEvent', 'myPage', 'mySearch', 'myStatus']) expect(params.has(key)).toBe(false);
  await expectNoOverflow(page);
});

test('manager invites four account-free guests, copies only from dialogs and can revoke unused passes', async ({ page, browser, context, request, fixture }, testInfo) => {
  const linkRequests = [];
  page.on('request', request => { if (/\/(referral-link|invitation-link)(?:\?|$)/.test(request.url())) linkRequests.push(request.url()); });
  await operatorScenario(request);
  await gestureClipboard(context, '__operatorCopiedLink');
  await openMyEvent(page, fixture);
  await expect(page.locator('.my-event-stats')).toContainText('$65.00');
  await expect(page.locator('.my-event-earnings')).toContainText('Unavailable');
  await page.getByRole('button', { name: 'Copy my referral link', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Referral link copied', exact: true })).toBeVisible();
  const referral = new URL(await page.evaluate(() => window.__operatorCopiedLink));
  expect(referral.searchParams.get('event')).toBe(fixture.ids.event);
  expect(referral.searchParams.has('ref')).toBe(true);
  expect(referral.searchParams.has('myEvent')).toBe(false);
  await guestlist(page).getByRole('button', { name: 'Invite a guest', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite a guest', exact: true });
  await expect(invite.getByRole('combobox', { name: 'Invite by', exact: true })).toHaveValue('personal');
  await expect(invite.getByRole('combobox', { name: 'Invite by', exact: true })).toBeDisabled();
  for (const select of await invite.getByRole('combobox').all()) {
    const bounds = await select.boundingBox();
    expect(bounds?.height, 'invitation selectors remain touch-sized on every browser').toBeGreaterThanOrEqual(44);
  }
  // Returning from another app rechecks access, but must not discard an open
  // invitation (or a potentially in-flight write) while that read is pending.
  let checkingAccess = false, releaseAccess;
  const accessReleased = new Promise(resolve => { releaseAccess = resolve; });
  const accessPattern = '**/api/customer/my-events/access';
  await page.route(accessPattern, async route => {
    checkingAccess = true;
    await accessReleased;
    await route.fulfill({ json: { data: { eligible: true } } });
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => checkingAccess).toBe(true);
    await expect(invite).toBeVisible();
    // The modal correctly hides background content from the accessibility
    // tree; inspect the retained DOM rather than an accessible heading role.
    await expect(page.locator('#my-event-stats-heading')).toHaveText('Event performance');
  } finally {
    const recheckedAccess = checkingAccess ? page.waitForResponse(response => response.url().endsWith('/api/customer/my-events/access')) : null;
    releaseAccess();
    if (recheckedAccess) await recheckedAccess;
    await page.unroute(accessPattern);
  }
  await invite.getByLabel('Guest name', { exact: true }).fill('Alex and friends');
  await invite.getByLabel('Spots', { exact: true }).fill('4');
  await expect(invite.getByLabel('Email address', { exact: true })).toHaveCount(0);
  await expectNoOverflow(page);
  await capture(page, testInfo, 'my-events-invitation-form');
  if (page.viewportSize().width <= 850) {
    const createBounds = await invite.getByRole('button', { name: 'Create invitation', exact: true }).boundingBox(), cancelBounds = await invite.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
    expect(createBounds.y + createBounds.height).toBeLessThanOrEqual(cancelBounds.y);
  }
  await expectSmallPhoneLayout(page);
  await invite.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const success = page.getByRole('dialog', { name: 'Your guest is on the list', exact: true });
  await expect(success).toContainText('4 spots approved');
  await expect(success).toContainText('4 separate single-use passes');
  const copyBounds = await success.getByRole('button', { name: 'Copy invitation link', exact: true }).boundingBox(), doneBounds = await success.getByRole('button', { name: 'Done', exact: true }).boundingBox();
  if (page.viewportSize().width <= 850) expect(copyBounds.y + copyBounds.height).toBeLessThanOrEqual(doneBounds.y);
  else expect(copyBounds.y).toBeCloseTo(doneBounds.y, 0);
  await success.getByRole('button', { name: 'Copy invitation link', exact: true }).click();
  await expect(success.getByRole('button', { name: 'Invitation link copied', exact: true })).toBeVisible();
  const link = await page.evaluate(() => window.__operatorCopiedLink);
  expect([...new URL(link).searchParams.keys()]).toEqual(['guestlistInvite']);
  await success.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(guestlist(page).getByRole('button', { name: /Copy.*link/i })).toHaveCount(0);
  await guestlist(page).getByRole('button', { name: 'Details for Alex and friends', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Alex and friends', exact: true });
  await expect(details.getByRole('button', { name: 'Copy invitation link', exact: true })).toBeEnabled();
  const prefetchedRequests = linkRequests.length;
  const detailCopyBounds = await details.getByRole('button', { name: 'Copy invitation link', exact: true }).boundingBox(), revokeBounds = await details.getByRole('button', { name: 'Revoke approval', exact: true }).boundingBox();
  expect(revokeBounds.x + revokeBounds.width).toBeLessThanOrEqual(detailCopyBounds.x);
  await expect(details.locator('.my-event-dialog-actions').getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
  await details.getByRole('button', { name: 'Copy invitation link', exact: true }).click();
  await expect(details).toContainText('Invitation link copied');
  expect(await page.evaluate(() => window.__operatorCopiedLink)).toBe(link);
  expect((await page.evaluate(() => window.__clipboardWrites)).immediate).toBeGreaterThan(0);
  expect(linkRequests).toHaveLength(prefetchedRequests);
  await expectNoOverflow(page);
  await capture(page, testInfo, 'my-events-guest-details');
  await expectSmallPhoneLayout(page);
  const guestContext = await browser.newContext({ viewport: page.viewportSize() });
  await guestContext.route(url => ['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort('blockedbyclient'));
  const guest = await guestContext.newPage();
  await guest.goto(link);
  expect(await guest.evaluate(() => localStorage.getItem('nitewide.session'))).toBeNull();
  await expect(guest.getByRole('heading', { name: "You're on the list, Alex and friends.", exact: true })).toBeVisible();
  const codes = [];
  for (let index = 0; index < 4; index++) {
    await expect(guest.locator('.pass-pager')).toContainText(`Pass ${index + 1} of 4`);
    const qr = guest.getByRole('img', { name: /QR code for guest list pass/ });
    await expect(qr).toBeVisible(); codes.push(await qr.getAttribute('src'));
    if (index < 3) await guest.getByRole('button', { name: 'Next pass', exact: true }).click();
  }
  expect(new Set(codes).size).toBe(4);
  await guestContext.close();
  await details.getByRole('button', { name: 'Revoke approval', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Alex and friends', exact: true });
  await expect(confirmation.getByRole('heading', { name: 'Revoke this approval?', exact: true })).toBeVisible();
  await expect(confirmation).toContainText(/pass|entry|approval/i);
  await confirmation.getByRole('button', { name: 'Confirm revocation', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(guestlist(page).locator('.my-event-guest-card').filter({ hasText: 'Alex and friends' })).toContainText('Denied');
  const revokedContext = await browser.newContext({ viewport: page.viewportSize() });
  const revoked = await revokedContext.newPage();
  await revoked.goto(link);
  await expect(revoked.getByRole('img', { name: /QR code for guest list pass/ })).toHaveCount(0);
  await revokedContext.close();
});

test('My events reviewer adjusts a five-spot request to four separate passes and a matching notification', async ({ page, browser, request, fixture }, testInfo) => {
  const customer = await requestFiveSpots({ browser, page, request, fixture, testInfo });
  try {
    await openMyEvent(page, fixture);
    await guestlist(page).getByRole('button', { name: 'Details for Pending Guest', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Pending Guest', exact: true });
    const spots = details.getByRole('spinbutton', { name: 'Approved spots', exact: true });
    await expect(spots).toHaveAttribute('aria-valuenow', '5');
    await details.getByRole('button', { name: 'Decrease approved spots', exact: true }).click();
    await expect(spots).toHaveAttribute('aria-valuenow', '4');
    await expectNoOverflow(page);
    await capture(page, testInfo, 'my-events-adjust-approval');
    await expectSmallPhoneLayout(page);
    const reviewed = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/guestlist/${customer.entry.id}/decision`));
    await details.getByRole('button', { name: 'Approve request', exact: true }).click();
    const response = await reviewed;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({ decision: 'approve', partySize: 4 });
    await expect(details).toHaveCount(0);
    await expectFourApprovedPasses(customer, fixture, testInfo);
  } finally { await customer.context.close(); }
});

for (const decision of ['approve', 'reject']) test(`manager can ${decision === 'approve' ? 'approve' : 'deny with confirmation'} a pending guestlist request`, async ({ page, fixture }) => {
  await openMyEvent(page, fixture);
  await guestlist(page).getByRole('button', { name: 'Details for Pending Guest', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Pending Guest', exact: true });
  await details.getByRole('button', { name: decision === 'approve' ? 'Approve request' : 'Deny request', exact: true }).click();
  if (decision === 'reject') {
    await expect(details.getByRole('heading', { name: 'Deny this request?', exact: true })).toBeVisible();
    await details.getByRole('button', { name: 'Keep request', exact: true }).click();
    await expect(details.getByRole('heading', { name: 'Deny this request?', exact: true })).toHaveCount(0);
    await details.getByRole('button', { name: 'Deny request', exact: true }).click();
    await details.getByRole('button', { name: 'Confirm denial', exact: true }).click();
  }
  await expect(details).toHaveCount(0);
  await expect(guestlist(page).locator('.my-event-guest-card').filter({ hasText: 'Pending Guest' })).toContainText(decision === 'approve' ? 'Approved' : 'Denied');
  await expectNoOverflow(page);
});

test('promoter sees only credited performance and their own guestlist, not direct requests', async ({ page, request, fixture }, testInfo) => {
  await operatorScenario(request);
  await openMyEvent(page, fixture, 'promoter');
  await expect(page.getByRole('heading', { name: 'Your performance', exact: true })).toBeVisible();
  await expect(page.locator('.my-event-stats')).toContainText('$25.00');
  await expect(page.locator('.my-event-stats')).not.toContainText('$65.00');
  await expect(page.locator('.my-event-earnings')).toContainText('$1.25');
  await expect(page.locator('.my-event-earnings')).toContainText('demo or sandbox orders');
  await expect(page.getByRole('link', { name: 'Open in Business', exact: true })).toHaveCount(0);
  await expect(guestlist(page)).not.toContainText('Pending Guest');
  const token = await sessionToken(page);
  const blocked = await request.get(`${urls.api}/api/customer/my-events/${fixture.ids.event}/guestlist-page/${fixture.ids.pending}`, { headers: { authorization: `Bearer ${token}` } });
  expect([403, 404]).toContain(blocked.status());
  await guestlist(page).getByRole('button', { name: 'Invite a guest', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite a guest', exact: true });
  await expect(invite).toContainText('My allocation');
  await expect(invite).not.toContainText('Event direct guestlist');
  await expectNoOverflow(page);
  await capture(page, testInfo, 'my-events-promoter');
});

test('past event guestlists and statistics are readable but invitations and reviews are rejected server-side', async ({ page, request, fixture }) => {
  await operatorScenario(request, true);
  await login(page, fixture, 'customer', 'business');
  await page.goto(`/?tab=my-events&myStatus=past&myEvent=${fixture.ids.event}`);
  await expect(page.getByRole('heading', { name: 'Event performance', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'This event has ended.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy my referral link', exact: true })).toBeDisabled();
  await expect(guestlist(page).getByRole('button', { name: 'Invite a guest', exact: true })).toHaveCount(0);
  await expect(guestlist(page)).toContainText('Pending Guest');
  await guestlist(page).getByRole('button', { name: 'Details for Pending Guest', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Pending Guest', exact: true });
  await expect(details.getByRole('button', { name: /Approve|Deny|Revoke/ })).toHaveCount(0);
  const token = await sessionToken(page);
  const headers = { authorization: `Bearer ${token}` };
  const review = await request.post(`${urls.api}/api/customer/my-events/${fixture.ids.event}/guestlist/${fixture.ids.pending}/decision`, { headers, data: { decision: 'approve' } });
  expect(review.status()).toBe(409);
  const invite = await request.post(`${urls.api}/api/customer/my-events/${fixture.ids.event}/guestlist-invitations`, { headers, data: { pool: 'direct', name: 'Too late', inviteBy: 'personal', partySize: 1 } });
  expect(invite.status()).toBe(409);
  await expectNoOverflow(page);
});

test('lost business access clears rendered operator data and removes the My events tab', async ({ page, fixture }) => {
  await openMyEvent(page, fixture);
  await page.route('**/api/customer/my-events/access', route => route.fulfill({ json: { data: { eligible: false } } }));
  await page.route(`**/api/customer/my-events/${fixture.ids.event}`, route => route.fulfill({ status: 403, json: { error: { message: 'Your business access was removed', code: 'BUSINESS_ACCESS_REQUIRED' } } }));
  await page.getByRole('button', { name: 'Refresh event details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your event access isn’t available.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event performance', exact: true })).toHaveCount(0);
  await expect(page.locator('.my-event-guestlist-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'My events', exact: true })).toHaveCount(0);
  await expectNoOverflow(page);
});
