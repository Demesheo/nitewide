const { test: baseTest, expect, loginViaApi, expectNoOverflow } = require('../fixtures.cjs');
const test = baseTest.extend({ fixtureRecipe: 'commerce' });
const paginationTest = baseTest.extend({ fixtureRecipe: 'bookings-pagination' });
const { urls } = require('../environment.cjs');

const savedCheckout = page => page.evaluate(() => localStorage.getItem(`nitewide.checkout.${JSON.parse(localStorage.getItem('nitewide.session')).user.id}`));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function selectVipCheckout(page) {
  const details = page.getByTestId('customer-event-details');
  await details.getByRole('button', { name: /VIP Package/ }).click();
  await details.getByRole('button', { name: /^Continue ·/ }).click();
  return details;
}

test('shared event preserves saved state, maps and free-versus-paid admission labels', async ({ page, fixture }, testInfo) => {
  await loginViaApi(page, fixture, 'customer', 'customer', `/events/${fixture.ids.event}?city=Miami%2C%20FL`);
  const details = page.getByTestId('customer-event-details');
  await expect(details.getByRole('heading', { name: 'Playwright Friday Night' })).toBeVisible();
  await expect(page).toHaveTitle(/Playwright Friday Night.*Nitewide/);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', `${urls.customer}/events/${fixture.ids.event}`);
  // Regression for CI: the authenticated header is intentionally inaccessible
  // while the deep-linked modal is open. Session setup must still complete.
  await expect(page.getByRole('button', { name: "Open Jordan Customer's profile" })).toHaveCount(0);
  await expect(page.getByRole('button', { name: "Open Jordan Customer's profile", includeHidden: true })).toBeAttached();
  await expect(details.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', /maps/);
  const paidOffering = details.getByRole('button', { name: /General Admission/ });
  await expect(paidOffering.locator('.upfront-total')).toContainText('$27.80');
  await expect(paidOffering.locator('.fee-caption')).toHaveText('$2.80 fees included');
  const offeredFeeSizes = await paidOffering.locator('.fee-caption').evaluate(caption => ({
    caption: Number.parseFloat(getComputedStyle(caption).fontSize),
    total: Number.parseFloat(getComputedStyle(caption.closest('button').querySelector('.upfront-total')).fontSize),
  }));
  expect(offeredFeeSizes.caption).toBeLessThan(offeredFeeSizes.total);
  await details.getByRole('button', { name: 'Increase quantity', exact: true }).click();
  await expect(paidOffering.locator('.upfront-total')).toContainText('$55.60');
  await expect(paidOffering.locator('strong')).toContainText('total for 2');
  await expect(paidOffering.locator('.fee-caption')).toHaveText('$5.60 fees included');
  await expect(details.getByRole('button', { name: 'Continue · $55.60', exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await testInfo.attach('upfront-customer-paid-fees', { body: await page.screenshot(), contentType: 'image/png' });
  await details.getByRole('button', { name: 'Decrease quantity', exact: true }).click();
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/customer/saved/${fixture.ids.event}`));
  await details.getByRole('button', { name: 'Save Playwright Friday Night', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(details.getByRole('button', { name: 'Unsave Playwright Friday Night', exact: true })).toBeVisible();
  await page.reload();
  await expect(details.getByRole('button', { name: 'Unsave Playwright Friday Night', exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).not.toHaveURL(/event=/);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('#saved').getByTestId('customer-event-card')).toHaveCount(1);
  const savedPrice = page.locator('#saved').getByTestId('customer-event-card').locator('.card-price');
  await expect(savedPrice).toContainText('From $27.80 total');
  await expect(savedPrice.locator('.fee-caption')).toHaveCount(0);
  await expect(savedPrice).not.toContainText(/\+\$[\d.]+ fee|\$[\d.]+ fees included|\bfee\b/i);
  await test.step('business-paid fees are itemized without increasing the customer total', async () => {
    await page.route(`**/api/events/${fixture.ids.event}`, async route => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.data.offerings = payload.data.offerings.map(item => ({ ...item, effectiveFeeMode: 'absorbed' }));
      await route.fulfill({ response, json: payload });
    });
    await page.goto(`/?event=${fixture.ids.event}`);
    await expect(paidOffering.locator('.upfront-total')).toContainText('$25');
    await expect(paidOffering.locator('.fee-caption')).toHaveText('$2.80 fees included');
    await details.getByRole('button', { name: 'Increase quantity', exact: true }).click();
    await expect(paidOffering.locator('.upfront-total')).toContainText('$50');
    await expect(paidOffering.locator('.fee-caption')).toHaveText('$5.60 fees included');
    await details.getByRole('button', { name: 'Continue · $50', exact: true }).click();
    const review = details.locator('.checkout-review');
    await expect(review.locator('.order-total .fee-caption')).toHaveText('$5.60 fees included');
    await expect(review.locator('.order-total dd')).toContainText('$50');
    const checkoutFeeSizes = await review.locator('.order-total .fee-caption').evaluate(caption => ({
      caption: Number.parseFloat(getComputedStyle(caption).fontSize),
      total: Number.parseFloat(getComputedStyle(caption.closest('dd')).fontSize),
    }));
    expect(checkoutFeeSizes.caption).toBeLessThan(checkoutFeeSizes.total);
    await expect(review).not.toContainText('Service fee');
    await expectNoOverflow(page);
    await testInfo.attach('business-paid-fee-review', { body: await page.screenshot(), contentType: 'image/png' });
    await page.unroute(`**/api/events/${fixture.ids.event}`);
  });
  await test.step('free offerings and claim review never advertise fees or a payment form', async () => {
    // Override only the read response for display coverage. No order is submitted
    // against the paid fixture, and production/sandbox data is not touched.
    await page.route(`**/api/events/${fixture.ids.event}`, async route => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.data.offerings = payload.data.offerings.map(item => ({ ...item, priceCents: 0 }));
      await route.fulfill({ response, json: payload });
    });
    await page.goto(`/?event=${fixture.ids.event}`);
    for (const name of [/General Admission/, /VIP Package/]) {
      const offering = details.getByRole('button', { name });
      await expect(offering.locator('strong')).toHaveText('Free');
      await expect(offering.locator('strong small')).toHaveCount(0);
    }
    await expect(details).not.toContainText(/\+\$[\d.]+ fee|includes \$[\d.]+(?: fee)?|\$[\d.]+ fees included|\+ fees/);
    await details.getByRole('button', { name: 'Claim free admission', exact: true }).click();
    const review = details.locator('.checkout-review');
    await expect(review.getByRole('button', { name: 'Claim admission', exact: true })).toBeEnabled();
    await expect(review.locator('.order-summary')).toContainText('1 × Free');
    await expect(review.locator('.order-summary dd')).toHaveText(['Free', 'Free']);
    await expect(review).not.toContainText(/Service fee|Taxes and any additional charges|\$0/);
    await expect(review.locator('.stripe-payment-form')).toHaveCount(0);
    await expect(review.getByRole('button', { name: /^Pay |Continue to payment/ })).toHaveCount(0);
    await expectNoOverflow(page);
    await testInfo.attach('free-admission-review', { body: await page.screenshot(), contentType: 'image/png' });
  });
});

paginationTest('booking pagination, guestlist passes and notifications navigate to the exact admissions', async ({ page, fixture }) => {
  await loginViaApi(page, fixture, 'customer', 'customer', '/?city=Miami%2C%20FL');
  await test.step('pagination and deep-linked guestlist use the correct entry', async () => {
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
  await test.step('each notification opens its exact pass and dismisses only itself', async () => {
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
});

test('pending guest can edit party size and withdraw without an admission QR', async ({ page, fixture }) => {
  await loginViaApi(page, fixture, 'customer', 'pending', `/?tab=booked&booking=guestlist:${fixture.ids.pending}`);
  await expect(page.getByText('Pending review', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code for/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit spots' }).click();
  await page.getByRole('button', { name: 'Increase guestlist spots', exact: true }).click();
  await page.getByRole('button', { name: 'Increase guestlist spots', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Spots', exact: true })).toHaveAttribute('aria-valuenow', '4');
  await page.getByRole('button', { name: 'Save spots' }).click();
  await expect(page.getByText('4 guests', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Withdraw request' }).click();
  await expect(page.getByRole('button', { name: /View guest list entry/ })).toHaveCount(0);
});

for (const recovery of ['reload', 'retry']) test(`checkout survives a committed order with a lost response and ${recovery} opens its exact passes`, async ({ page, fixture }) => {
  await loginViaApi(page, fixture, 'customer', 'customer', `/?event=${fixture.ids.event}`);
  const details = await selectVipCheckout(page);
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
  if (recovery === 'retry') await test.step('pending verification retains the same key and never reposts the order', async () => {
    const keys = [];
    const pendingStatus = route => {
      keys.push(route.request().url().split('/').pop());
      return route.fulfill({ json: { data: { status: 'pending' } } });
    };
    await page.route('**/api/customer/checkout-attempts/*', pendingStatus);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await details.getByRole('button', { name: 'Check / retry booking' }).click();
      await expect(details.getByRole('alert').filter({ hasText: 'still being checked' })).toBeVisible();
      await expect(details.getByRole('button', { name: 'Check / retry booking' })).toBeEnabled();
    }
    expect(posts).toBe(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(JSON.parse(await savedCheckout(page)).body.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    await expect(page.getByRole('img', { name: /QR code for ticket/ })).toHaveCount(0);
    await page.unroute('**/api/customer/checkout-attempts/*', pendingStatus);
  });
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

test('sandbox Pay checks server status, preserves review across reload and opens only verified passes', async ({ page, fixture }) => {
  await page.route('https://js.stripe.com/**', route => route.abort());
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: true, configured: true, mode: 'test', publishableKey: 'pk_test_fixture_offline', demoEnabled: false } } }));
  await loginViaApi(page, fixture, 'customer', 'customer', `/?event=${fixture.ids.event}`);
  const details = await selectVipCheckout(page);
  let key;
  let prepares = 0, review = true;
  await page.route('**/api/customer/checkout-attempts/*', route => route.fulfill({ status: 404, json: { error: { message: 'Absent' } } }));
  await page.route('**/api/customer/payment-checkouts', route => {
    const body = route.request().postDataJSON();
    prepares += 1;
    key = body.idempotencyKey;
    expect(body.payment).toBeUndefined();
    return route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', clientSecret: 'fixture_checkout_secret', stripeAccountId: 'acct_fixture', expiresAt: new Date(Date.now() + 300000).toISOString() } } });
  });
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/verify`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: review ? 'pending' : 'paid', verificationStatus: review ? 'review' : 'verified' } } }));
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/resume`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', verificationStatus: review ? 'review' : 'pending', clientSecret: review ? null : 'fixture_checkout_secret', stripeAccountId: 'acct_fixture' } } }));
  await details.getByRole('button', { name: 'Continue to payment', exact: true }).click();
  await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Check booking', exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('nitewide.session')).user;
    return localStorage.getItem(`nitewide.checkout.${user.id}`);
  });
  expect(saved).toContain(key); expect(saved).not.toContain('fixture_checkout_secret');
  await test.step('payment review forbids a second payment and premature admissions, even after reload', async () => {
    await details.getByRole('button', { name: /^Pay / }).click();
    await expect(details.getByRole('status')).toContainText('needs review');
    await expect(details.getByRole('button', { name: 'Cancel payment attempt' })).toHaveCount(0);
    await expect(details.getByRole('button', { name: /^Pay / })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Check booking', exact: true })).toHaveCount(0);
    await page.route(`**/api/events/${fixture.ids.event}`, route => route.fulfill({ status: 404, json: { error: { message: 'Event unavailable' } } }));
    await page.reload();
    await expect(details.getByRole('status')).toContainText('needs review');
    await expect(details.getByRole('button', { name: 'Check booking', exact: true })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Cancel payment attempt' })).toHaveCount(0);
    await expect(details.getByRole('button', { name: /^Pay / })).toHaveCount(0);
    expect(prepares).toBe(1);
    expect(await savedCheckout(page)).toContain(key);
    await expect(page.getByRole('img', { name: /QR code for ticket/ })).toHaveCount(0);
    await expectNoOverflow(page);
  });
  review = false;
  await page.reload();
  await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
  await details.getByRole('button', { name: /^Pay / }).click();
  await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${fixture.ids.order}`));
  await expect(page.getByRole('img', { name: /QR code for ticket 1/ })).toBeVisible();
  expect(prepares).toBe(1);
  expect(await savedCheckout(page)).toBeNull();
  await expectNoOverflow(page);
});

test('incomplete sandbox configuration shows unavailable payments without falling back to demo', async ({ page, fixture }) => {
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: false, configured: true, mode: 'test', publishableKey: null, demoEnabled: true } } }));
  await loginViaApi(page, fixture, 'customer', 'customer', `/?event=${fixture.ids.event}`);
  const details = await selectVipCheckout(page);
  await expect(details.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  await expect(details.getByRole('button', { name: 'Confirm demo booking' })).toHaveCount(0);
  await expect(details).toContainText('Checkout is unavailable right now. Please try again later.');
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
  await loginViaApi(page, fixture, 'customer');
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
  let releaseInitialEventRequest;
  let initialEventRequestSeen;
  const initialEventGate = new Promise(resolve => { releaseInitialEventRequest = resolve; });
  const initialEventSeen = new Promise(resolve => { initialEventRequestSeen = resolve; });
  let eventRequests = 0;
  const holdInitialEventRequest = async route => {
    if (route.request().method() === 'GET' && ++eventRequests === 1) {
      initialEventRequestSeen();
      await initialEventGate;
    }
    await route.continue();
  };
  const eventUrl = `**/api/events/${fixture.ids.event}`;
  await page.route(eventUrl, holdInitialEventRequest);
  await page.addInitScript(eventId => {
    const nativeFetch = window.fetch.bind(window);
    let initialEventFetchObserved = false;
    window.__nitewideInitialEventPayloadConsumed = false;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = init?.method || input?.method || 'GET';
      const watchThisResponse = !initialEventFetchObserved && method === 'GET' && url.includes(`/api/events/${eventId}`);
      if (watchThisResponse) initialEventFetchObserved = true;
      const responsePromise = nativeFetch(input, init);
      if (!watchThisResponse) return responsePromise;
      return responsePromise.then(response => {
        const nativeJson = response.json.bind(response);
        Object.defineProperty(response, 'json', {
          configurable: true,
          value: async (...args) => {
            const payload = await nativeJson(...args);
            if (payload?.data && typeof payload.data === 'object') {
              const data = payload.data;
              Object.defineProperty(payload, 'data', {
                configurable: true,
                get() {
                  window.__nitewideInitialEventPayloadConsumed = true;
                  return data;
                },
              });
            }
            return payload;
          },
        });
        return response;
      });
    };
  }, fixture.ids.event);
  let reload;
  try {
    // On reload, the initial deep-link event load and checkout recovery each
    // fetch this event. Hold only the first request so recovery can complete.
    reload = page.reload();
    await initialEventSeen;
    await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
    expect(eventRequests).toBeGreaterThanOrEqual(2);
    const releasedEventResponse = page.waitForResponse(response =>
      response.url().includes(`/api/events/${fixture.ids.event}`) && response.request().method() === 'GET');
    releaseInitialEventRequest();
    await releasedEventResponse;
    // Wait until the app consumes the delayed response payload, then let its
    // route callback and React update paint before checking the restored stage.
    await page.waitForFunction(() => window.__nitewideInitialEventPayloadConsumed === true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await reload;
  } finally {
    releaseInitialEventRequest();
    if (reload) await reload.catch(() => {});
    await page.unroute(eventUrl, holdInitialEventRequest);
  }
  await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
  expect(JSON.parse(await saved()).body.idempotencyKey).toBe(first.body.idempotencyKey);
  expect(prepares).toEqual([]);
  expect(resumes.length).toBeGreaterThanOrEqual(3);
  expect(resumes.every(method => method === 'POST')).toBeTruthy();
  await expectNoOverflow(page);
});

test('abandoned sandbox checkout reconciles already-paid orders and expires unpaid orders without a second payment', async ({ page, fixture }) => {
  await loginViaApi(page, fixture, 'customer');
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

test('cancelled and refunded saved checkouts retire on reload and allow explicitly renewed payment', async ({ page, fixture }) => {
  await loginViaApi(page, fixture, 'customer');
  const booking = (await abandonedCheckoutFixture(page, fixture))();
  let status;
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/resume`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status, booking } } }));
  const prepares = [];
  await page.route('**/api/customer/checkout-attempts/*', route => route.fulfill({ status: 404, json: { error: { message: 'Absent' } } }));
  await page.route('**/api/customer/payment-checkouts', route => {
    prepares.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', clientSecret: 'fixture_new_secret', stripeAccountId: 'acct_fixture' } } });
  });
  for (status of ['cancelled', 'refunded']) await test.step(`${status} requires a fresh, explicitly submitted attempt`, async () => {
    await page.evaluate(({ orderId, booking }) => {
      const buyerId = JSON.parse(localStorage.getItem('nitewide.session')).user.id;
      localStorage.setItem(`nitewide.checkout.${buyerId}`, JSON.stringify({ buyerId, orderId, mode: 'stripe',
        body: { eventId: booking.event.id, idempotencyKey: booking.idempotencyKey, items: booking.items.map(item => ({ offeringId: item.offeringId, quantity: item.quantity })), expectedTotalCents: booking.totalCents } }));
    }, { orderId: fixture.ids.order, booking });
    const previousPrepares = prepares.length;
    await page.goto(`/?event=${fixture.ids.event}`);
    const details = page.getByTestId('customer-event-details');
    await expect.poll(() => savedCheckout(page)).toBeNull();
    expect(prepares).toHaveLength(previousPrepares);
    await expect(details.getByRole('button', { name: 'Resume checkout', exact: true })).toHaveCount(0);
    await selectVipCheckout(page);
    await expect(details.getByRole('button', { name: 'Continue to payment', exact: true })).toBeEnabled();
    await details.getByRole('button', { name: 'Continue to payment', exact: true }).click();
    await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
    expect(prepares).toHaveLength(previousPrepares + 1);
    expect(prepares.at(-1).idempotencyKey).not.toBe(booking.idempotencyKey);
    expect(JSON.parse(await savedCheckout(page)).body.idempotencyKey).toBe(prepares.at(-1).idempotencyKey);
    await expectNoOverflow(page);
  });
  expect(prepares[0].idempotencyKey).not.toBe(prepares[1].idempotencyKey);
});

test('saved attributed sandbox checkout preserves referral credit through recovery, cancellation and reload', async ({ page, fixture }) => {
  await loginViaApi(page, fixture, 'customer');
  const booking = (await abandonedCheckoutFixture(page, fixture))();
  const affiliateCode = 'PW-EVENT-LEO';
  const initialVisitStarted = deferred(), releaseInitialVisit = deferred(), initialVisitDelivered = deferred();
  let visits = 0;
  await page.route(`**/api/events/${fixture.ids.event}/referral-visits`, async route => {
    const initial = ++visits === 1;
    if (initial) { initialVisitStarted.resolve(); await releaseInitialVisit.promise; }
    try {
      await route.fulfill({ json: { data: { code: affiliateCode, referrerName: 'Leo Promoter' } } });
    } catch (error) {
      if (!initial) throw error;
      // Recovery may abort the initial deep-link request after taking ownership.
    } finally { if (initial) initialVisitDelivered.resolve(); }
  });
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/resume`, route => route.fulfill({ json: { data: {
    orderId: fixture.ids.order, status: 'pending', verificationStatus: 'pending',
    clientSecret: 'fixture_attributed_secret', stripeAccountId: 'acct_fixture', booking,
  } } }));
  await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/cancel`, route => route.fulfill({ json: { data: {
    orderId: fixture.ids.order, status: 'cancelled',
  } } }));
  await page.route('**/api/customer/checkout-attempts/*', route => route.fulfill({ status: 404, json: { error: { message: 'Absent' } } }));
  const prepares = [];
  await page.route('**/api/customer/payment-checkouts', route => {
    prepares.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: { orderId: fixture.ids.order, status: 'pending', clientSecret: 'fixture_renewed_secret', stripeAccountId: 'acct_fixture' } } });
  });
  await page.evaluate(({ orderId, booking, affiliateCode }) => {
    const buyerId = JSON.parse(localStorage.getItem('nitewide.session')).user.id;
    localStorage.setItem(`nitewide.checkout.${buyerId}`, JSON.stringify({ buyerId, orderId, mode: 'stripe', referrerName: 'Leo Promoter',
      body: { eventId: booking.event.id, idempotencyKey: booking.idempotencyKey, affiliateCode,
        items: booking.items.map(item => ({ offeringId: item.offeringId, quantity: item.quantity })), expectedTotalCents: booking.totalCents } }));
  }, { orderId: fixture.ids.order, booking, affiliateCode });
  const details = page.getByTestId('customer-event-details');
  try {
    await page.goto(`/?event=${fixture.ids.event}&ref=${affiliateCode}`);
    await initialVisitStarted.promise;
    // Hold the initial referral response so only the saved attempt can supply
    // the credit when recovery restores the event and rewrites its route.
    await expect(details.getByRole('button', { name: 'Cancel payment attempt' })).toBeEnabled();
    expect(new URL(page.url()).searchParams.get('ref')).toBe(affiliateCode);
    const restored = JSON.parse(await savedCheckout(page));
    expect(restored.body.affiliateCode).toBe(affiliateCode);
    expect(restored.body.idempotencyKey).toBe(booking.idempotencyKey);
    expect(prepares).toEqual([]);
    releaseInitialVisit.resolve();
    await initialVisitDelivered.promise;
    await details.getByRole('button', { name: 'Cancel payment attempt' }).click();
    await expect(details.getByRole('button', { name: /^Continue ·/ })).toBeEnabled();
    expect(await savedCheckout(page)).toBeNull();
    expect(new URL(page.url()).searchParams.get('ref')).toBe(affiliateCode);
    await page.reload();
    await expect(details.locator('.connection-context')).toContainText('Leo Promoter');
    expect(await savedCheckout(page)).toBeNull();
    expect(prepares).toEqual([]);
    await selectVipCheckout(page);
    await details.getByRole('button', { name: 'Continue to payment', exact: true }).click();
    await expect(details.getByRole('button', { name: /^Pay / })).toBeVisible();
    expect(prepares).toHaveLength(1);
    expect(prepares[0].affiliateCode).toBe(affiliateCode);
    expect(prepares[0].eventId).toBe(fixture.ids.event);
    expect(prepares[0].idempotencyKey).not.toBe(booking.idempotencyKey);
    expect(JSON.parse(await savedCheckout(page)).body.affiliateCode).toBe(affiliateCode);
    await expectNoOverflow(page);
  } finally { releaseInitialVisit.resolve(); }
});

test('Continue retires an ended saved sandbox checkout in one click without silently resubmitting', async ({ page, fixture }) => {
  await loginViaApi(page, fixture, 'customer');
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

test('secure form loading and cancellation retain the checkout until the server confirms its end', async ({ page, fixture }) => {
  let releaseStripe;
  const stripeGate = new Promise(resolve => { releaseStripe = resolve; });
  await page.route('https://js.stripe.com/**', async route => { await stripeGate; await route.abort(); });
  await page.route('**/api/customer/payment-config', route => route.fulfill({ json: { data: { enabled: true, configured: true, mode: 'test', publishableKey: 'pk_test_fixture_offline', demoEnabled: false } } }));
  try {
    await loginViaApi(page, fixture, 'customer', 'customer', `/?event=${fixture.ids.event}`);
    const details = await selectVipCheckout(page);
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
    await test.step('an uncertain cancellation preserves the key; confirmed cancellation retires it', async () => {
      let cancellation = 'pending';
      await page.route(`**/api/customer/payment-checkouts/${fixture.ids.order}/cancel`, route => route.fulfill({ json: { data: { orderId: fixture.ids.order, status: cancellation } } }));
      await details.getByRole('button', { name: 'Cancel payment attempt' }).click();
      await expect(details.getByRole('alert').filter({ hasText: 'still being checked' })).toBeVisible();
      expect(await savedCheckout(page)).toBeTruthy();
      cancellation = 'cancelled';
      await details.getByRole('button', { name: 'Cancel payment attempt' }).click();
      await expect(details.getByRole('button', { name: /^Continue ·/ })).toBeVisible();
      expect(await savedCheckout(page)).toBeNull();
      await expectNoOverflow(page);
    });
  } finally { releaseStripe(); }
});

test('a rejected cart can be revised with a fresh key, then creates VIP passes and one receipt notification', async ({ page, request, fixture }) => {
  await loginViaApi(page, fixture, 'customer', 'customer', `/?event=${fixture.ids.event}`);
  const details = await selectVipCheckout(page);
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
  await test.step('definitive price rejection retires the old attempt before cart revision', async () => {
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
  await test.step('the real revised purchase issues individual passes and one asynchronous receipt', async () => {
    await expect(page.getByText('Pass 1 of 6', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next pass' }).click();
    await expect(page.getByText('Pass 2 of 6', { exact: true })).toBeVisible();
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
});
