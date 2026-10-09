const { test: baseTest, expect, loginViaApi, expectNoOverflow } = require('../fixtures.cjs');
const test = baseTest.extend({ fixtureRecipe: 'commerce' });
const authTest = baseTest.extend({ fixtureRecipe: 'customer-auth' });
const paginationTest = baseTest.extend({ fixtureRecipe: 'events-pagination' });
const operatorTest = baseTest.extend({ fixtureRecipe: 'operator' });
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
  // Directory search and navigation have their own interaction test below.
  await loginViaApi(page, fixture, 'customer', role, `/?tab=my-events&myEvent=${fixture.ids.event}`);
  await expect(page.getByRole('heading', { name: 'Playwright Friday Night', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^(Event performance|Your performance)$/ })).toBeVisible();
}

async function sessionToken(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
}

function guestlist(page) { return page.locator('.my-event-guestlist-panel'); }
async function capture(page, testInfo, name, fullPage = false) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled', fullPage });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
async function expectSmallPhoneLayout(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoOverflow(page);
  await page.setViewportSize(viewport);
}

paginationTest('My events and Booked navigation load once and stay quiet on focus, visibility and idle time', async ({ page, fixture }) => {
  const reads = [], cancelled = [], pending = new Set();
  const tracked = request => request.method() === 'GET' && /^\/api\/(notifications|customer\/(messages|connections\/summary|my-events|rundowns|bookings)|support\/messages)(?:[/?]|$)/.test(new URL(request.url()).pathname);
  page.on('request', request => { if (tracked(request)) { reads.push(new URL(request.url()).pathname); pending.add(request); } });
  page.on('requestfinished', request => pending.delete(request));
  page.on('requestfailed', request => { pending.delete(request); if (tracked(request)) cancelled.push(request.url()); });
  await loginViaApi(page, fixture, 'customer', 'business', '/?city=Orlando%2C+FL');
  await expect(page.getByRole('button', { name: 'My events', exact: true })).toBeVisible();
  await expect.poll(() => pending.size).toBe(0);
  await page.clock.install();
  const count = (path, from = 0) => reads.slice(from).filter(value => value === path).length;
  const myNavigation = reads.length;
  await page.getByRole('button', { name: 'My events', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Rundown', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View Playwright Friday Night operations', exact: true })).toBeVisible();
  await expect.poll(() => pending.size).toBe(0);
  for (const path of ['/api/customer/my-events/access', '/api/customer/my-events', '/api/customer/rundowns', '/api/notifications', '/api/customer/messages', '/api/support/messages', '/api/customer/connections/summary']) {
    expect(count(path, myNavigation), `one read of ${path} on My events navigation`).toBe(1);
  }
  async function remainsQuiet() {
    const before = reads.length;
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(65000);
    await expect.poll(() => pending.size).toBe(0);
    expect(reads).toHaveLength(before);
    expect(cancelled).toEqual([]);
  }
  await remainsQuiet();
  const bookedNavigation = reads.length;
  await page.getByRole('button', { name: 'Booked', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Booked.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Something to look forward to.', exact: true })).toBeVisible();
  await expect.poll(() => pending.size).toBe(0);
  for (const path of ['/api/customer/bookings', '/api/notifications', '/api/customer/messages', '/api/support/messages', '/api/customer/connections/summary']) {
    expect(count(path, bookedNavigation), `one read of ${path} on Booked navigation`).toBe(1);
  }
  await remainsQuiet();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Something to look forward to.', exact: true })).toBeVisible();
  await expect.poll(() => pending.size).toBe(0);
  expect(count('/api/customer/bookings', bookedNavigation)).toBe(2, 'a browser reload refreshes bookings');
  expect(count('/api/notifications', bookedNavigation)).toBe(2, 'a browser reload refreshes notifications');
  expect(count('/api/customer/messages', bookedNavigation)).toBe(2, 'a browser reload refreshes messages');
  expect(cancelled).toEqual([]);
});

paginationTest('business rundown viewing before sharing, six-flyer paging and anonymous checkout keep generic credit', async ({ page, context, fixture }, testInfo) => {
  await gestureClipboard(context, '__rundownLink');
  await loginViaApi(page, fixture, 'customer', 'business', '/?tab=my-events');
  const rundownChoice = page.getByRole('combobox', { name: 'Rundown', exact: true });
  const triggerBox = await rundownChoice.boundingBox();
  await rundownChoice.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expectNoOverflow(page);
  if (testInfo.project.name.endsWith('iphone')) {
    const menuBox = await page.getByRole('listbox').boundingBox();
    expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  }
  await capture(page, testInfo, 'rundown-picker-open');
  await page.getByRole('option', { name: 'Playwright Nightlife', exact: true }).click();
  await expect(rundownChoice).toContainText('Playwright Nightlife');
  const previewLink = page.getByRole('link', { name: 'View', exact: true });
  await expect(previewLink).toHaveAttribute('href', /rundownPreview=/);
  const previewOpened = page.waitForEvent('popup');
  await previewLink.click();
  const preview = await previewOpened;
  await expect(preview.getByRole('heading', { name: 'Playwright Nightlife’s Rundown', exact: true })).toBeVisible();
  await expect(preview.getByTestId('rundown-event-card')).toHaveCount(6);
  await preview.getByTestId('rundown-event-card').first().getByRole('link').click();
  await expect(preview.getByTestId('customer-event-details')).toBeVisible();
  await preview.reload();
  await expect(preview.getByTestId('customer-event-details')).toBeVisible();
  await preview.getByTestId('customer-event-details').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(preview.getByTestId('rundown-event-card')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'My events.', exact: true })).toBeVisible();
  await preview.close();
  await expectNoOverflow(page);
  await expect(page.locator('.rundown-share-buttons svg')).toHaveCount(0);
  await page.getByRole('heading', { name: 'My events.', exact: true }).hover();
  const actionStyle = selector => page.locator(selector).evaluate(node => {
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return { background: style.backgroundImage, backgroundColor: style.backgroundColor,
      color: style.color, border: style.border, radius: style.borderRadius, fontSize: style.fontSize,
      fontWeight: style.fontWeight, height: box.height };
  });
  await expect(async () => {
    expect(await actionStyle('.rundown-share-buttons a')).toEqual(await actionStyle('.rundown-share-buttons button'));
  }).toPass();
  const sharingGeometry = await page.locator('.rundown-sharing').evaluate(panel => {
    const share = panel.querySelector('.rundown-share-buttons button').getBoundingClientRect();
    const view = panel.querySelector('.rundown-share-buttons a').getBoundingClientRect();
    const choice = panel.querySelector('.rundown-choice-trigger').getBoundingClientRect();
    return { right: panel.querySelector('.rundown-sharing-controls').getBoundingClientRect().right, shareRight: share.right,
      shareTop: share.top, viewTop: view.top, choiceWidth: choice.width, choiceTop: choice.top };
  });
  expect(Math.abs(sharingGeometry.right - sharingGeometry.shareRight)).toBeLessThanOrEqual(1);
  expect(sharingGeometry.shareTop).toBe(sharingGeometry.viewTop);
  if (testInfo.project.name.endsWith('desktop')) {
    expect(sharingGeometry.choiceWidth).toBeGreaterThan(300);
    expect(sharingGeometry.choiceTop).toBe(sharingGeometry.shareTop);
  }
  await capture(page, testInfo, 'rundown-sharing-controls');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share your rundown', exact: true });
  await expect(share.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish rundown', exact: true })).toHaveCount(0);
  await share.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(share.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  const link = await page.evaluate(() => window.__rundownLink);
  const url = new URL(link);
  expect(url.pathname).toMatch(/^\/rundowns\/[0-9a-f-]{36}$/);
  expect([...url.searchParams.keys()]).toEqual([]);
  await page.evaluate(() => localStorage.removeItem('nitewide.session'));
  const discoveryRequests = [];
  page.on('request', request => { if (/\/api\/(events\?|discovery\/|location)/.test(request.url())) discoveryRequests.push(request.url()); });
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Playwright Nightlife’s Rundown', exact: true })).toBeVisible();
  const cards = page.getByTestId('rundown-event-card');
  await expect(cards).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await expectNoOverflow(page);
  if (testInfo.project.name.endsWith('iphone')) {
    const geometry = await cards.evaluateAll(items => ({ rects: items.map(item => { const r = item.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom }; }), height: window.innerHeight }));
    expect(geometry.rects[0].y).toBe(geometry.rects[1].y);
    expect(geometry.rects[2].y).toBe(geometry.rects[3].y);
    expect(geometry.rects[4].y).toBe(geometry.rects[5].y);
    expect(geometry.rects[4].y).toBeGreaterThan(geometry.rects[2].y);
    expect(geometry.rects[5].bottom).toBeLessThanOrEqual(geometry.height);
  }
  await capture(page, testInfo, 'business-rundown-six-flyers', testInfo.project.name.endsWith('desktop'));
  await page.getByRole('button', { name: 'View more', exact: true }).click();
  await expect(cards).toHaveCount(12);
  const firstId = await cards.first().getAttribute('data-event-id');
  await cards.first().getByRole('link').click();
  const details = page.getByTestId('customer-event-details');
  await expect(details).toBeVisible();
  expect(new URL(page.url()).searchParams.get('rundown')).toBe(url.pathname.split('/')[2]);
  expect(new URL(page.url()).searchParams.has('ref')).toBe(false);
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(cards).toHaveCount(12);
  expect(discoveryRequests).toEqual([]);
  // A customer can use the usual checkout at the public link. The shared
  // business link must not inherit a previous personal affiliate context.
  await loginViaApi(page, fixture, 'customer', 'customer', `${url.pathname}${url.search}`);
  await page.getByTestId('rundown-event-card').first().getByRole('link').click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  const ordered = page.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'POST');
  await details.getByRole('button', { name: 'Confirm demo booking', exact: true }).click();
  const response = await ordered;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON().affiliateCode || null).toBeNull();
  expect(response.request().postDataJSON().eventId).toBe(firstId);
  await expect(page).toHaveURL(/tab=booked/);
  expect(new URL(page.url()).searchParams.has('rundown')).toBe(false);
  await expectNoOverflow(page);
});

paginationTest('personal rundown survives details reload and preserves referral credit at purchase', async ({ page, context, fixture }) => {
  await gestureClipboard(context, '__personalRundownLink');
  await loginViaApi(page, fixture, 'customer', 'promoter', '/?tab=my-events');
  const previewLink = page.getByRole('link', { name: 'View', exact: true });
  await expect(previewLink).toHaveAttribute('href', /rundownPreview=personal/);
  const previewOpened = page.waitForEvent('popup');
  await previewLink.click();
  const preview = await previewOpened;
  await expect(preview.getByRole('heading', { name: 'Leo Promoter’s Rundown', exact: true })).toBeVisible();
  await expect(preview.getByTestId('rundown-event-card')).toHaveCount(6);
  expect(new URL(preview.url()).searchParams.has('ref')).toBe(false);
  await expect(page.getByRole('heading', { name: 'My events.', exact: true })).toBeVisible();
  await preview.close();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share your rundown', exact: true });
  await expect(share.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await share.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(share.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  const link = await page.evaluate(() => window.__personalRundownLink);
  const rundownId = new URL(link).pathname.split('/')[2];
  await page.evaluate(() => localStorage.removeItem('nitewide.session'));
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Leo Promoter’s Rundown', exact: true })).toBeVisible();
  await expect(page.getByTestId('rundown-event-card')).toHaveCount(6);
  await page.getByTestId('rundown-event-card').first().getByRole('link').click();
  const details = page.getByTestId('customer-event-details');
  await expect(details).toBeVisible();
  expect(new URL(page.url()).searchParams.get('ref')).toBe(`RUN-${rundownId}`);
  await page.reload();
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(page.getByTestId('rundown-event-card')).toHaveCount(6);
  const closed = new URL(page.url());
  expect(closed.pathname).toBe(`/rundowns/${rundownId}`);
  expect(closed.searchParams.has('event')).toBe(false);
  expect(closed.searchParams.has('ref')).toBe(false);
  await loginViaApi(page, fixture, 'customer', 'customer', `${closed.pathname}${closed.search}`);
  await page.getByTestId('rundown-event-card').first().getByRole('link').click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  const ordered = page.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'POST');
  await details.getByRole('button', { name: 'Confirm demo booking', exact: true }).click();
  const response = await ordered;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON().affiliateCode).toBe(`RUN-${rundownId}`);
  expect((await response.json()).data.order.eventAffiliateId).toBe(fixture.ids.affiliate);
  await expect(page).toHaveURL(/tab=booked/);
  await expectNoOverflow(page);
});

authTest('My events is hidden for customer-only accounts and its API rejects direct access', async ({ page, request, fixture }) => {
  await loginViaApi(page, fixture, 'customer');
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

paginationTest('manager directory, referral-copy recovery and guest approval end by clearing revoked event access', async ({ page, context, fixture }, testInfo) => {
  const requests = [];
  page.on('request', request => { if (/\/api\/customer\/my-events\?/.test(request.url())) requests.push(request.url()); });
  await refusedClipboard(context);
  await loginViaApi(page, fixture, 'customer', 'business');
  await test.step('explicit search and server pagination retain history and clean discovery navigation', async () => {
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
  await page.getByRole('button', { name: 'My events', exact: true }).click();
  await page.getByRole('button', { name: 'View Playwright Friday Night operations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Playwright Friday Night', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event performance', exact: true })).toBeVisible();
  await test.step('clipboard refusal offers a selectable referral link and retry clears the fallback', async () => {
    await page.getByRole('button', { name: 'Copy my referral link', exact: true }).click();
    const manual = page.getByRole('textbox', { name: 'Copy link manually', exact: true });
    await expect(manual).toBeVisible();
    await expect(manual).toHaveAttribute('readonly', '');
    const link = await manual.inputValue();
    expect(new URL(link).pathname).toBe(`/events/${fixture.ids.event}`);
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
  await test.step('manager approves the original request without changing its two spots', async () => {
    await guestlist(page).getByRole('button', { name: 'Details for Pending Guest', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Pending Guest', exact: true });
    await expect(details.getByRole('spinbutton', { name: 'Approved spots', exact: true })).toHaveAttribute('aria-valuenow', '2');
    const reviewed = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/guestlist/${fixture.ids.pending}/decision`));
    await details.getByRole('button', { name: 'Approve request', exact: true }).click();
    const response = await reviewed;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({ decision: 'approve', partySize: 2 });
    await expect(details).toHaveCount(0);
    await expect(guestlist(page).locator('.my-event-guest-card').filter({ hasText: 'Pending Guest' })).toContainText('Approved');
    await expectNoOverflow(page);
  });
  await test.step('removed business access clears rendered event data and the My events tab', async () => {
    await page.route('**/api/customer/my-events/access', route => route.fulfill({ json: { data: { eligible: false } } }));
    await page.route(`**/api/customer/my-events/${fixture.ids.event}`, route => route.fulfill({ status: 403, json: { error: { message: 'Your business access was removed', code: 'BUSINESS_ACCESS_REQUIRED' } } }));
    await page.getByRole('button', { name: 'Refresh event details', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your event access isn’t available.', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Event performance', exact: true })).toHaveCount(0);
    await expect(guestlist(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'My events', exact: true })).toHaveCount(0);
    await expectNoOverflow(page);
  });
});

operatorTest('manager invites four account-free guests, copies only from dialogs and can revoke unused passes', async ({ page, browser, context, request, fixture }, testInfo) => {
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
  expect(referral.pathname).toBe(`/events/${fixture.ids.event}`);
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
  // Returning focus must not reload access or discard an open invitation.
  const accessRequests = [];
  const trackAccess = request => { if (request.url().endsWith('/api/customer/my-events/access')) accessRequests.push(request.url()); };
  page.on('request', trackAccess);
  try {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(invite).toBeVisible();
    // The modal correctly hides background content from the accessibility
    // tree; inspect the retained DOM rather than an accessible heading role.
    await expect(page.locator('#my-event-stats-heading')).toHaveText('Event performance');
    expect(accessRequests).toHaveLength(0);
  } finally {
    page.off('request', trackAccess);
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

test('manager can cancel a guestlist denial confirmation and then explicitly deny the pending request', async ({ page, fixture }) => {
  await openMyEvent(page, fixture);
  await guestlist(page).getByRole('button', { name: 'Details for Pending Guest', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Pending Guest', exact: true });
  await test.step('cancel denial keeps the original request pending', async () => {
    await details.getByRole('button', { name: 'Deny request', exact: true }).click();
    await expect(details.getByRole('heading', { name: 'Deny this request?', exact: true })).toBeVisible();
    await details.getByRole('button', { name: 'Keep request', exact: true }).click();
    await expect(details.getByRole('heading', { name: 'Deny this request?', exact: true })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Approve request', exact: true })).toBeEnabled();
  });
  await test.step('explicit confirmation denies the guest and closes the review', async () => {
    await details.getByRole('button', { name: 'Deny request', exact: true }).click();
    await details.getByRole('button', { name: 'Confirm denial', exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect(guestlist(page).locator('.my-event-guest-card').filter({ hasText: 'Pending Guest' })).toContainText('Denied');
  });
  await expectNoOverflow(page);
});

operatorTest('promoter sees only credited performance and their own guestlist, not direct requests', async ({ page, request, fixture }, testInfo) => {
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

operatorTest('past event guestlists and statistics are readable but invitations and reviews are rejected server-side', async ({ page, request, fixture }) => {
  await operatorScenario(request, true);
  await loginViaApi(page, fixture, 'customer', 'business', `/?tab=my-events&myStatus=past&myEvent=${fixture.ids.event}`);
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
