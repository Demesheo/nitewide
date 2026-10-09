const { test: baseTest, expect, expectNoOverflow } = require('../fixtures.cjs');
const test = baseTest.extend({ fixtureRecipe: 'commerce' });
const discoveryTest = baseTest.extend({ fixtureRecipe: 'customer-discovery' });
const { expectBrandImage, expectBrandIcons } = require('../brand-checks.cjs');
const { urls } = require('../environment.cjs');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

discoveryTest('customer discovery keeps its chosen area, branding and private signed-out support', async ({ page, fixture }, testInfo) => {
  const geoStarted = deferred(), releaseGeo = deferred(), geoDelivered = deferred();
  const discoveryRequests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/events') discoveryRequests.push(url.searchParams);
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(_success, failure) { failure({ code: 1 }); } } });
  });
  await page.route('https://api.bigdatacloud.net/data/reverse-geocode-client?**', async route => {
    geoStarted.resolve();
    await releaseGeo.promise;
    await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { city: 'Miami', principalSubdivisionCode: 'US-FL', countryCode: 'US' } });
    geoDelivered.resolve();
  });
  const cards = page.locator('#discover').getByTestId('customer-event-card');
  const cityInput = page.getByRole('combobox', { name: 'City', exact: true });
  const areaControls = page.getByRole('group', { name: 'Discovery area' });
  const otherMarkets = ['Miami', 'Miami Beach', 'Tampa', 'St. Petersburg', 'Fort Lauderdale'];
  await test.step('unresolved location never loads a global feed; a manual nearby area wins over late IP detection', async () => {
    await page.goto('/');
    await geoStarted.promise;
    await expect(page.getByText('Choose an area to find your night.', { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(0);
    expect(discoveryRequests).toHaveLength(0);
    await cityInput.fill('Winter Park');
    await expect(cityInput).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('listbox', { name: 'City suggestions' }).getByRole('option', { name: /^Winter Park, FL/ }).click();
    await expect(cityInput).toHaveValue('Winter Park, FL');
    expect(discoveryRequests).toHaveLength(0);
    await page.getByRole('button', { name: 'Find my night', exact: true }).click();
    await expect(cards).toHaveCount(9);
    await expect(page.locator('#discovery-area-hint')).toHaveCount(0);
    await expect(page.locator('#discover .results-summary')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^City:/ })).toHaveCount(0);
    for (const quickDate of ['Tonight', 'Tomorrow', 'This weekend']) {
      await expect(page.getByRole('button', { name: quickDate, exact: true })).toHaveCount(0);
    }
    await expect(areaControls.getByRole('button', { name: 'Include nearby cities', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const discoveryHeading = page.locator('#discover .section-heading h2');
    const sortSelect = page.locator('#discover .section-heading').getByLabel('Sort', { exact: true });
    await expect(discoveryHeading).toBeVisible();
    await expect(sortSelect).toBeVisible();
    // Submission scrolls to results. Separate protocol calls can sample two
    // scroll frames, so measure both controls synchronously in the same frame.
    const { headingBounds, sortBounds } = await page.locator('#discover .section-heading').evaluate(element => ({
      headingBounds: element.querySelector('h2')?.getBoundingClientRect().toJSON() ?? null,
      sortBounds: element.querySelector('select[aria-label="Sort"]')?.getBoundingClientRect().toJSON() ?? null,
    }));
    expect(headingBounds).not.toBeNull();
    expect(sortBounds).not.toBeNull();
    expect(Math.abs((headingBounds.y + headingBounds.height / 2) - (sortBounds.y + sortBounds.height / 2))).toBeLessThanOrEqual(2);
    await expect(sortSelect).toHaveValue('recommended');
    await expect(sortSelect.locator('option:checked')).toHaveText('Popular');
    await expect(cards.filter({ hasText: 'Playwright Winter Park Night' }).locator('.card-location')).toHaveText('Winter Park, FL');
    await expect(cards.filter({ hasText: 'Playwright Kissimmee Night' }).locator('.card-location')).toHaveText('Kissimmee, FL');
    expect(await cards.locator('.card-location').allTextContents()).toEqual(expect.arrayContaining(['Orlando, FL', 'Winter Park, FL', 'Kissimmee, FL']));
    for (const city of otherMarkets) await expect(cards.filter({ hasText: `Playwright ${city} Night` })).toHaveCount(0);
    await expect(cards.locator('.premium-host-badge')).toHaveCount(8);
    await test.step('exact-city scope excludes Orlando and Kissimmee, and nearby scope restores the metro', async () => {
      await areaControls.getByRole('button', { name: /^Winter Park.* only$/ }).click();
      await expect(areaControls.getByRole('button', { name: /^Winter Park.* only$/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(cards).toHaveCount(1);
      await expect(cards.locator('.card-location')).toHaveText(['Winter Park, FL']);
      await areaControls.getByRole('button', { name: 'Include nearby cities', exact: true }).click();
      await expect(cards).toHaveCount(9);
      expect(await cards.locator('.card-location').allTextContents()).toEqual(expect.arrayContaining(['Orlando, FL', 'Winter Park, FL', 'Kissimmee, FL']));
    });
    const dateSortResponse = page.waitForResponse(response => {
      const url = new URL(response.url()); return url.pathname === '/api/events' && url.searchParams.get('sort') === 'date';
    });
    await page.getByLabel('Sort', { exact: true }).selectOption('date');
    await dateSortResponse;
    await expect.poll(async () => {
      const titles = await cards.locator('.card-title-text').allTextContents();
      return titles.indexOf('Playwright Night 04') < titles.indexOf('Playwright Night 05');
    }).toBe(true);
    await expect(cards.locator('.premium-host-badge')).toHaveCount(8);
    const dateOrdered = await cards.allTextContents();
    expect(dateOrdered.findIndex(text => text.includes('Playwright Night 04'))).toBeLessThan(dateOrdered.findIndex(text => text.includes('Playwright Night 05')));
    await expect(cards.filter({ hasText: 'Playwright Night 04' }).locator('.premium-host-badge')).toHaveCount(0);
    await expect(cards.filter({ hasText: 'Playwright Night 05' }).locator('.premium-host-badge')).toHaveCount(1);
    const datePair = await Promise.all(['Playwright Night 04', 'Playwright Night 05'].map(title => cards.filter({ hasText: title }).locator('time').getAttribute('datetime')));
    const datePairDetails = await page.evaluate(([earlier, later]) => ({ earlierDay: new Date(earlier).toLocaleDateString(), laterDay: new Date(later).toLocaleDateString(), ascending: Date.parse(earlier) < Date.parse(later) }), datePair);
    expect(datePairDetails.earlierDay).toBe(datePairDetails.laterDay);
    expect(datePairDetails.ascending).toBe(true);
    releaseGeo.resolve();
    await geoDelivered.promise;
    await expect(cityInput).toHaveValue('Winter Park, FL');
    await expect(cards).toHaveCount(9);
    await page.getByRole('button', { name: 'More nights, more possibilities' }).click();
    await expect(cards).toHaveCount(10);
    expect(discoveryRequests.at(-1).get('sort')).toBe('date');
    expect(discoveryRequests.at(-1).get('scope')).toBe('nearby');
    expect(discoveryRequests.at(-1).get('mode')).toBe('upcoming');
    await expect(cards.filter({ hasText: 'Playwright Night 10' }).locator('.premium-host-badge')).toHaveCount(1);
    const laterNight = await cards.filter({ hasText: 'Playwright Night 10' }).locator('time').getAttribute('datetime');
    expect(Date.parse(laterNight) - Date.now()).toBeGreaterThan(14 * 24 * 3600000);
    for (const city of otherMarkets) await expect(cards.filter({ hasText: `Playwright ${city} Night` })).toHaveCount(0);
  });
  await test.step('a return visit uses the remembered area', async () => {
    await page.goto('/');
    await expect(cityInput).toHaveValue('Winter Park, FL');
    await expect(cards).toHaveCount(9);
  });
  const home = page.getByRole('banner').getByRole('link', { name: 'Nitewide home', exact: true });
  await expectBrandImage(home.locator('img'));
  await expectBrandIcons(page);
  await expectNoOverflow(page);
  await test.info().attach('customer-brand-header', { body: await page.screenshot(), contentType: 'image/png' });
  const footer = page.getByRole('contentinfo');
  await footer.scrollIntoViewIfNeeded();
  await expectBrandImage(footer.getByRole('link', { name: 'Nitewide home', exact: true }).locator('img'));
  await expect(footer.getByRole('link', { name: 'For business', exact: true })).toBeVisible();
  await test.step('footer privacy is public, reloadable, quiet, and accepts a private request without an account', async () => {
    const link = footer.getByRole('link', { name: 'Privacy policy', exact: true });
    await expect(link).toHaveAttribute('href', `${urls.customer}/privacy`);
    const requests = [];
    const observe = request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); };
    page.on('request', observe);
    try {
      await link.click();
      await expect(page.getByRole('heading', { name: 'Nitewide Privacy Policy', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('navigation', { name: 'Privacy policy contents', exact: true })).toBeVisible();
      await expectNoOverflow(page);
      await testInfo.attach('public-privacy-policy', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      await page.getByRole('navigation', { name: 'Privacy policy contents' }).getByRole('link', { name: 'Privacy requests and U.S. state rights' }).click();
      await expect(page.locator('#rights')).toBeInViewport();
      await page.getByRole('button', { name: 'Contact Nitewide', exact: true }).click();
      const privacySupport = page.getByRole('dialog', { name: 'Contact Nitewide', exact: true });
      await expect(privacySupport.getByText(/Private privacy requests with Nitewide/)).toBeVisible();
      expect(requests).toEqual([]);
      await privacySupport.getByRole('textbox', { name: 'Your name', exact: true }).fill('Guest privacy requester');
      await privacySupport.getByRole('textbox', { name: 'Email', exact: true }).fill(fixture.accounts.customer.email);
      await privacySupport.getByRole('textbox', { name: 'Describe the issue', exact: true }).fill('Privacy request: please tell me how to request a copy of my information.');
      await privacySupport.getByRole('button', { name: 'Send to Nitewide', exact: true }).click();
      await expect(privacySupport.getByLabel('Support conversation')).toContainText('Privacy request:');
      await expect(privacySupport.locator('.support-messages')).toHaveAttribute('aria-busy', 'false');
      await page.reload();
      const recovered = page.getByRole('dialog', { name: 'Contact Nitewide', exact: true });
      await expect(recovered.getByLabel('Support conversation')).toContainText('Privacy request:');
      await recovered.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('banner').getByRole('link', { name: 'Return to Nitewide', exact: true }).click();
      await expect(cards).toHaveCount(9);
    } finally { page.off('request', observe); }
    await footer.scrollIntoViewIfNeeded();
  });
  await expectNoOverflow(page);
  await footer.getByRole('button', { name: 'Contact Nitewide', exact: true }).click();
  const support = page.getByRole('dialog', { name: 'Contact Nitewide', exact: true });
  await expect(support.getByText(/Help with signing in or accessing your account/)).toBeVisible();
  await expect(support.getByRole('combobox')).toHaveCount(0);
  await support.getByRole('textbox', { name: 'Your name', exact: true }).fill('Customer needing access');
  await support.getByRole('textbox', { name: 'Email', exact: true }).fill(fixture.accounts.customer.email);
  await support.getByRole('textbox', { name: 'Describe the issue', exact: true }).fill('I cannot sign into my customer account.');
  const sent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/support/access-requests' && response.request().method() === 'POST');
  await support.getByRole('button', { name: 'Send to Nitewide', exact: true }).click();
  expect((await sent).ok()).toBeTruthy();
  await expect(support.getByRole('button', { name: 'Copy private recovery link', exact: true })).toBeVisible();
  await expect(support.getByLabel('Support conversation')).toContainText('I cannot sign into my customer account.');
  await expect(support.locator('.support-messages')).toHaveAttribute('aria-busy', 'false');
  await support.evaluate(element => { element.scrollTop = 0; });
  await expectNoOverflow(page);
  const supportScreenshot = testInfo.outputPath('customer-private-support.png');
  await page.screenshot({ path: supportScreenshot });
  await testInfo.attach('customer-private-support', { path: supportScreenshot, contentType: 'image/png' });
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Contact Nitewide', exact: true }).getByLabel('Support conversation')).toContainText('I cannot sign into my customer account.');
  await page.getByRole('dialog', { name: 'Contact Nitewide', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await footer.getByRole('link', { name: 'Nitewide home', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/' && !url.searchParams.has('event'));
  await expect(home).toBeVisible();
  await test.step('empty search/date results and the weekly preview remain within an established area', async () => {
    await page.getByLabel('Search', { exact: true }).fill('no such fixture night');
    await page.getByRole('button', { name: 'Find my night', exact: true }).click();
    await expect(page.locator('#discover').getByRole('heading', { name: /No experiences/ })).toBeVisible();
    await expect(page.getByText(/Nitewide coming soon to/)).toHaveCount(0);
    await page.getByLabel('Search', { exact: true }).fill('');
    const yesterday = await page.evaluate(() => {
      const day = new Date(); day.setDate(day.getDate() - 1);
      return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    });
    await page.getByLabel('Event date', { exact: true }).fill(yesterday);
    await page.getByRole('button', { name: 'Find my night', exact: true }).click();
    expect(discoveryRequests.at(-1).get('mode')).toBe('range');
    expect(discoveryRequests.at(-1).get('startDate')).toBe(yesterday);
    expect(discoveryRequests.at(-1).get('endDate')).toBe(yesterday);
    expect(new URL(page.url()).searchParams.get('date')).toBe(yesterday);
    expect(new URL(page.url()).searchParams.has('when')).toBe(false);
    await expect(cards).toHaveCount(0);
    const preview = page.locator('.upcoming-preview').getByTestId('customer-event-card');
    await expect(preview).toHaveCount(9);
    await expect(preview.filter({ hasText: 'Playwright Winter Park Night' })).toHaveCount(1);
    await expect(preview.filter({ hasText: 'Playwright Kissimmee Night' })).toHaveCount(1);
    for (const city of otherMarkets) await expect(preview.filter({ hasText: `Playwright ${city} Night` })).toHaveCount(0);
    await expect(page.getByText(/Nitewide coming soon to/)).toHaveCount(0);
    await page.getByLabel('Event date', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Find my night', exact: true }).click();
    await expect(cards).toHaveCount(9);
    expect(discoveryRequests.at(-1).get('mode')).toBe('upcoming');
    expect(discoveryRequests.at(-1).has('endDate')).toBe(false);
    expect(new URL(page.url()).searchParams.has('date')).toBe(false);
    expect(new URL(page.url()).searchParams.has('when')).toBe(false);
  });
  await test.step('switching to a failed city clears cards and rejects an older pagination response', async () => {
    const pageStarted = deferred(), releasePage = deferred(), pageDelivered = deferred();
    const miamiStarted = deferred(), releaseMiami = deferred();
    const raceRoute = async route => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('cursor') && params.get('city') === 'Winter Park, FL') {
        const response = await route.fetch();
        const payload = await response.json();
        pageStarted.resolve();
        await releasePage.promise;
        try { await route.fulfill({ response, json: payload }); } catch { /* The superseded request may already be aborted. */ }
        finally { pageDelivered.resolve(); }
      } else if (params.get('city')?.startsWith('Miami,')) {
        miamiStarted.resolve();
        await releaseMiami.promise;
        await route.fulfill({ status: 503, json: { error: { message: 'Fixture city temporarily unavailable' } } });
      } else await route.continue();
    };
    await page.route('**/api/events?**', raceRoute);
    try {
      await page.getByRole('button', { name: 'More nights, more possibilities' }).click();
      await pageStarted.promise;
      await page.getByLabel('City', { exact: true }).fill('Miami, FL');
      // Manual qualified-city submission must work even after suggestions load,
      // not only in the short interval before the autocomplete response arrives.
      await expect(page.getByRole('listbox', { name: 'City suggestions' }).getByRole('option', { name: /^Miami, FL/ })).toBeVisible();
      await expect(page.getByRole('listbox', { name: 'City suggestions' }).getByRole('option')).toHaveText(['Miami, FL']);
      await page.getByRole('button', { name: 'Find my night', exact: true }).click();
      await miamiStarted.promise;
      await expect(cards).toHaveCount(0);
      releasePage.resolve();
      await pageDelivered.promise;
      await expect(cards).toHaveCount(0);
      releaseMiami.resolve();
      await expect(page.getByText(/We couldn’t load events/)).toBeVisible();
      await expect(cards).toHaveCount(0);
    } finally {
      releasePage.resolve(); releaseMiami.resolve();
      await page.unroute('**/api/events?**', raceRoute);
    }
  });
  await test.step('nearby cities use their metro group without crossing Miami and Fort Lauderdale divisions', async () => {
    await cityInput.fill('Miami Beach, FL');
    await page.getByRole('button', { name: 'Find my night', exact: true }).click();
    await expect(cards).toHaveCount(2);
    await expect(cityInput).toHaveValue('Miami Beach, FL');
    await expect(areaControls.getByRole('button', { name: 'Include nearby cities', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await cards.locator('.card-location').allTextContents()).toEqual(expect.arrayContaining(['Miami, FL', 'Miami Beach, FL']));
    await expect(cards.filter({ hasText: 'Playwright Fort Lauderdale Night' })).toHaveCount(0);
    await cityInput.fill('St. Petersburg, FL');
    await page.getByRole('button', { name: 'Find my night', exact: true }).click();
    await expect(cards).toHaveCount(2);
    await expect(cityInput).toHaveValue('St. Petersburg, FL');
    await expect(areaControls.getByRole('button', { name: 'Include nearby cities', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await cards.locator('.card-location').allTextContents()).toEqual(expect.arrayContaining(['Tampa, FL', 'St. Petersburg, FL']));
    for (const city of ['Miami', 'Miami Beach', 'Fort Lauderdale', 'Orlando']) await expect(cards.filter({ hasText: `Playwright ${city} Night` })).toHaveCount(0);
  });
  await test.step('a locality without upcoming events invites businesses through the configured app', async () => {
    await page.getByLabel('City', { exact: true }).fill('Gainesville, FL');
    await page.getByRole('button', { name: 'Find my night', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nitewide coming soon to Gainesville', exact: true })).toBeVisible();
    await expect(cards).toHaveCount(0);
    const invitation = page.getByRole('link', { name: 'Nitewide Business', exact: true });
    await expect(invitation).toBeVisible();
    const href = new URL(await invitation.getAttribute('href'), page.url());
    expect(href.origin).toBe(urls.business);
    expect(href.pathname).toBe('/');
  });
  await test.step('clearing the selected city returns to area selection without widening discovery', async () => {
    const before = discoveryRequests.length;
    await cityInput.fill('');
    await page.getByRole('button', { name: 'Find my night', exact: true }).click();
    await expect(cityInput).toHaveValue('');
    expect(new URL(page.url()).searchParams.get('city')).toBe('');
    await expect(page.getByText('Choose an area to find your night.', { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(0);
    expect(discoveryRequests).toHaveLength(before);
  });
  expect(discoveryRequests.every(params => params.get('city') && !params.has('allCities'))).toBeTruthy();
  await expectNoOverflow(page);
});
