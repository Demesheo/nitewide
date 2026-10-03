const { expect, loginViaApi, expectNoOverflow } = require('./fixtures.cjs');
const { urls } = require('./environment.cjs');

// A separate browser session keeps the guest and reviewer identities isolated.
// All requests still target the generated Playwright database, never dev data.
async function fiveSpotRequest({ browser, page, request, fixture, testInfo }, throughUi) {
  const context = await browser.newContext({ viewport: page.viewportSize(),
    isMobile: Boolean(testInfo.project.use.isMobile), hasTouch: Boolean(testInfo.project.use.hasTouch),
    reducedMotion: 'reduce', serviceWorkers: 'block' });
  const errors = [];
  const guest = await context.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  await context.route(url => ['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort('blockedbyclient'));
  try {
    const { accessToken: token } = await loginViaApi(guest, fixture, 'customer', 'pending');
    const headers = { authorization: `Bearer ${token}` };
    const withdrawn = await request.delete(`${urls.api}/api/customer/guestlists/${fixture.ids.pending}`, { headers });
    expect(withdrawn.ok()).toBeTruthy();
    if (!throughUi) {
      // The Customer My events journey covers the real request form on
      // both devices. Business review needs a real pending API request, not a
      // second tour of that same form. Its review, notification and QR passes
      // still use the actual Business and Customer interfaces and database.
      const submitted = await request.post(`${urls.api}/api/events/${fixture.ids.event}/guestlist`, { headers, data: { partySize: 5 } });
      expect(submitted.status()).toBe(202);
      const entry = (await submitted.json()).data.entry;
      expect(entry.partySize).toBe(5);
      expect(entry.status).toBe('pending');
      return { context, guest, entry, token, errors, request };
    }
    const invalid = await request.post(`${urls.api}/api/events/${fixture.ids.event}/guestlist`, { headers, data: { partySize: 6 } });
    expect(invalid.status(), 'the server also caps customer requests at five').toBe(422);
    await guest.goto(`${urls.customer}/?event=${fixture.ids.event}`);
    const details = guest.getByTestId('customer-event-details');
    await details.getByRole('tab', { name: 'Guestlist', exact: true }).click();
    const spots = details.getByRole('spinbutton', { name: 'Party size, including you', exact: true });
    const increase = details.getByRole('button', { name: 'Increase guestlist spots', exact: true });
    const decrease = details.getByRole('button', { name: 'Decrease guestlist spots', exact: true });
    await expect(spots).toHaveAttribute('aria-valuenow', '1');
    await expect(decrease).toBeDisabled();
    for (let index = 0; index < 4; index++) await increase.click();
    await expect(spots).toHaveAttribute('aria-valuenow', '5');
    await expect(increase).toBeDisabled();
    expect((await increase.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expectNoOverflow(guest);
    const screenshot = testInfo.outputPath('customer-five-spot-request.png');
    await guest.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('customer-five-spot-request', { path: screenshot, contentType: 'image/png' });
    const submitted = guest.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/events/${fixture.ids.event}/guestlist`));
    await details.getByRole('button', { name: 'Request guestlist approval', exact: true }).click();
    const response = await submitted;
    expect(response.ok()).toBeTruthy();
    const entry = (await response.json()).data.entry;
    expect(entry.partySize).toBe(5);
    expect(entry.status).toBe('pending');
    await expect(details.getByRole('heading', { name: 'Awaiting host approval.', exact: true })).toBeVisible();
    return { context, guest, entry, token, errors, request };
  } catch (error) { await context.close(); throw error; }
}

const requestFiveSpots = options => fiveSpotRequest(options, true);
const seedFiveSpotRequest = options => fiveSpotRequest(options, false);

async function expectFourApprovedPasses({ guest, entry, token, request, errors }, _fixture, testInfo) {
  const response = await request.get(`${urls.api}/api/customer/guestlists/${entry.id}/pass`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.ok()).toBeTruthy();
  const pass = (await response.json()).data;
  expect(pass.partySize).toBe(4);
  expect(pass.tickets).toHaveLength(4);
  expect(new Set(pass.tickets.map(ticket => ticket.id)).size).toBe(4);
  expect(pass.tickets.every(ticket => ticket.spots === 1 && ticket.qrImage)).toBeTruthy();
  await guest.goto(urls.customer);
  await guest.getByRole('button', { name: /^Notifications/ }).click();
  const approved = guest.getByRole('dialog', { name: 'Notifications', exact: true }).getByRole('button', { name: /Guestlist approved/ });
  await expect(approved).toContainText(`You were approved for 4 spots on the guestlist for ${pass.event.title}.`);
  await approved.click();
  await expect(guest).toHaveURL(new RegExp(`booking=guestlist(?:%3A|:)${entry.id}`));
  const qr = guest.getByRole('img', { name: /QR code for guest list pass/ });
  const codes = [];
  for (let index = 0; index < 4; index++) {
    await expect(guest.locator('.pass-pager')).toContainText(`Pass ${index + 1} of 4`);
    await expect(qr).toBeVisible(); codes.push(await qr.getAttribute('src'));
    if (index < 3) await guest.getByRole('button', { name: 'Next pass', exact: true }).click();
  }
  await expect(guest.getByRole('button', { name: 'Next pass', exact: true })).toBeDisabled();
  expect(new Set(codes).size).toBe(4);
  await expectNoOverflow(guest);
  const screenshot = testInfo.outputPath('four-approved-guest-passes.png');
  await guest.screenshot({ path: screenshot, animations: 'disabled' });
  await testInfo.attach('four-approved-guest-passes', { path: screenshot, contentType: 'image/png' });
  expect(errors, 'guest session has no uncaught runtime errors').toEqual([]);
}

module.exports = { requestFiveSpots, seedFiveSpotRequest, expectFourApprovedPasses };
