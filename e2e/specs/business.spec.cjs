const { test, expect, login, businessSection, expectNoOverflow } = require('../fixtures.cjs');
const QRCode = require('qrcode');
const { urls } = require('../environment.cjs');
const { checkPasswordVisibility, checkOnboardingPasswords } = require('../password-visibility.cjs');

// These use the real production build served by the isolated preview, not a
// Vite optimizer URL. Only the lazy App asset fails; the entry/recovery code
// remains available. No auth submission, email, or fixture mutation is needed.
for (const failure of ['unavailable chunk','route render failure']) {
  test(`business startup recovery handles ${failure} without an automatic reload or session reset`,async ({page,browserName}) => {
    const privateMarker = 'synthetic-private-error-payload';
    const rawSession = JSON.stringify({accessToken:'synthetic-expired-session',expiresAt:'2000-01-01T00:00:00.000Z'});
    let documents = 0,failures = 0,blocked = true;
    const messages = [];
    page.on('console',message => messages.push(message.text()));
    page.on('request',request => {if (request.isNavigationRequest() && request.resourceType() === 'document') documents += 1;});
    await page.goto('/');
    await page.evaluate(value => sessionStorage.setItem('nitewide.business.session',value),rawSession);
    const appAsset = url => url.origin === urls.business && /^\/assets\/App-[^/]+\.js$/.test(url.pathname);
    await page.route(appAsset,route => {
      if (!blocked) return route.continue();
      failures += 1;
      return failure === 'unavailable chunk'
        ? route.fulfill({status:504,contentType:'text/plain',headers:{'Cache-Control':'no-store'},body:'This workspace asset is temporarily unavailable.'})
        : route.fulfill({contentType:'application/javascript',headers:{'Cache-Control':'no-store'},body:`export default function BrokenBusinessRoute() { throw new Error(${JSON.stringify(privateMarker)}); }`});
    });
    const address = `${urls.business}/sign-in?returnTo=%2Fapp%3Fsection%3Devents#resume`;
    await page.goto(address);
    await expect(page.getByRole('heading',{name:'This page couldn’t open',exact:true})).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Unsaved information may need to be entered again');
    await expect(page.getByRole('heading',{name:'This page couldn’t open',exact:true})).toBeFocused();
    await expect(page).toHaveURL(address); await expectNoOverflow(page);
    expect(failures).toBeGreaterThan(0);
    expect(await page.evaluate(() => sessionStorage.getItem('nitewide.business.session'))).toBe(rawSession);
    expect(await page.locator('body').innerText()).not.toContain(privateMarker);
    expect(messages.join('\n')).not.toContain(privateMarker);
    const initialDocuments = documents;
    // The recovery waits for the person, even after the connection recovers.
    blocked = false;
    await expect(page.getByRole('button',{name:'Reload page',exact:true})).toBeVisible();
    expect(documents).toBe(initialDocuments);
    await Promise.all([
      page.waitForEvent('framenavigated',frame => frame === page.mainFrame()),
      page.getByRole('button',{name:'Reload page',exact:true}).click(),
    ]);
    if (browserName === 'webkit') {
      // WebKit retains failed dynamic modules in this browsing context even
      // after a manual reload. Assert honest safe guidance, not recovery that
      // our real HTTP504 diagnostic could not deliver. Normal boot is tested
      // independently below; no automatic tabs or secret copying workaround.
      await expect(page.getByRole('heading',{name:'This page couldn’t open',exact:true})).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('close and reopen your browser');
      await expect(page.getByRole('button',{name:'Reload page',exact:true})).toBeVisible();
    } else {
      await expect(page.getByRole('button',{name:'Sign in to Nitewide',exact:true})).toBeVisible();
    }
    await expect(page).toHaveURL(address);
    expect(documents).toBe(initialDocuments+1);
    expect(await page.evaluate(() => sessionStorage.getItem('nitewide.business.session'))).toBe(rawSession);
  });
}

test('business startup retains a safe static recovery message when its production entry asset is unavailable',async ({page}) => {
  const rawSession = JSON.stringify({accessToken:'synthetic-expired-session',expiresAt:'2000-01-01T00:00:00.000Z'});
  await page.goto('/');
  await page.evaluate(value => sessionStorage.setItem('nitewide.business.session',value),rawSession);
  await page.route(url => url.origin === urls.business && /^\/assets\/index-[^/]+\.js$/.test(url.pathname),route => route.fulfill({status:504,contentType:'text/plain',headers:{'Cache-Control':'no-store'},body:'Startup temporarily unavailable.'}));
  const address = `${urls.business}/sign-in?returnTo=%2Fapp#resume`;
  await page.goto(address);
  await expect(page.getByRole('heading',{name:'Opening Nitewide Business…',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Your stored sign-in session will remain');
  await expect(page).toHaveURL(address); await expectNoOverflow(page);
  expect(await page.evaluate(() => sessionStorage.getItem('nitewide.business.session'))).toBe(rawSession);
  expect(await page.locator('body').innerText()).not.toContain('synthetic-expired-session');
});

test('business sign-in boots normally on a clean browser page without exposing recovery UI',async ({page}) => {
  await page.goto('/sign-in');
  await expect(page.getByLabel('Work email',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Password',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sign in to Nitewide',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'This page couldn’t open',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Opening Nitewide Business…',exact:true})).toHaveCount(0);
  await expectNoOverflow(page);
});

test('business password visibility works independently in login and reset without submitting', async ({ page }) => {
  const actions = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/auth/')) actions.push(request.url()); });
  await page.goto('/sign-in');
  await checkPasswordVisibility(page, 'Password');
  await page.goto('/sign-in?resetPassword=synthetic-visibility-token');
  await checkPasswordVisibility(page, 'New password');
  await checkPasswordVisibility(page, 'Confirm new password', 'confirmed password');
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'password');
  await expectNoOverflow(page);
  await checkOnboardingPasswords(page, '/app');
  await page.route('**/api/team/invitations/synthetic-visibility-token', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: {
    email: 'visibility@playwright.nitewide.test', organizationName: 'Visibility Test', role: 'employee',
  } }) }));
  await page.goto('/app?invite=synthetic-visibility-token');
  await checkPasswordVisibility(page, 'Password');
  await page.getByRole('button', { name: 'New to Nitewide? Create an account', exact: true }).click();
  await checkPasswordVisibility(page, 'Password');
  await expectNoOverflow(page);
  expect(actions).toEqual([]);
});
test('business profile logout revokes the token server-side', async ({ page, request, fixture }) => {
  await login(page, fixture, 'business');
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nitewide.business.session')).accessToken);
  await page.getByRole('button', { name: 'Your profile', exact: true }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in to Nitewide', exact: true })).toBeVisible();
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
});
test('failed business logout keeps the profile open with a retryable error', async ({ page, fixture }) => {
  await login(page, fixture, 'business');
  await page.getByRole('button', { name: 'Your profile', exact: true }).click();
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Security controls are temporarily unavailable. Please try again.' } }) }));
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Security controls are temporarily unavailable');
  expect(await page.evaluate(() => Boolean(sessionStorage.getItem('nitewide.business.session')))).toBe(true);
});
async function eventDetails(page, fixture) {
  // Authenticate on the deep link itself, as a guest opening an event would.
  // This also avoids unloading a just-mounted overview with requests in flight.
  await login(page, fixture, 'business', 'business', `/app?section=events&event=${fixture.ids.event}`);
  await expect(page.getByRole('heading', { name: 'Playwright Friday Night', exact: true })).toBeVisible();
}
async function admissions(page, fixture, role = 'business') {
  await login(page, fixture, 'business', role);
  await businessSection(page, 'Admissions');
  await page.getByRole('button', { name: 'Start admissions for Playwright Friday Night', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready at the door' })).toBeVisible();
}

test('business sections can change while overview reports are loading', async ({ page, fixture }) => {
  await eventDetails(page, fixture);
  for (let attempt = 0; attempt < 3; attempt++) {
    const reportStarted = page.waitForRequest(request => request.url().includes('/api/business/reports/summary?'));
    await businessSection(page, 'Overview');
    await reportStarted;
    await businessSection(page, 'Events');
    await expect(page).toHaveURL(/section=events/);
  }
  await businessSection(page, 'Overview');
  await expect(page.locator('.business-overview')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.business-overview').getByRole('alert')).toHaveCount(0);
});
test('business sign in and section navigation retain clean URLs', async ({ page, fixture }) => {
  await login(page, fixture, 'business');
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
    await expect(drawer).toBeVisible();
    const bounds = await drawer.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(drawer).not.toBeVisible();
  }
  for (const section of ['Events', 'Analytics', 'Admissions', 'Organization', 'Overview']) {
    await businessSection(page, section);
    await expectNoOverflow(page);
  }
  await expect(page).toHaveURL(/\/app(?:\?section=overview)?$/);
});

test('overview charts switch categories and team pagination uses the backend', async ({ page, fixture }) => {
  await login(page, fixture, 'business');
  const mix = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Sales mix', exact: true }) });
  await mix.getByRole('tab', { name: 'Events', exact: true }).click();
  await expect(mix).toContainText('Playwright Friday Night');
  await mix.getByRole('tab', { name: 'Tickets & packages' }).click();
  await expect(mix).toContainText('General Admission');
  const pager = page.getByRole('group', { name: 'Pagination for team members' });
  await expect(pager).toBeVisible();
  await pager.getByRole('button', { name: 'Next' }).click();
  await expect(pager).toContainText('Page 2');
  await pager.getByRole('button', { name: 'Previous' }).click();
  await expect(pager).toContainText('Page 1');
});

test('manager referral and personal pool support a ten-spot private invitation', async ({ page, fixture }) => {
  await eventDetails(page, fixture);
  const share = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Your referral link', exact: true }) }).last();
  await expect(share.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await share.getByRole('button', { name: 'Invite guest', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite to guestlist', exact: true });
  await expect(dialog.getByLabel('Invite by')).toHaveValue('phone');
  await dialog.getByLabel('Guestlist pool').selectOption({ label: 'My allocation · 10 places' });
  await dialog.getByLabel('Phone number').fill('+14075550123');
  await dialog.getByLabel('People').fill('10');
  await dialog.getByRole('button', { name: /Create invitation|Invite guest|Send invite/ }).click();
  await expect(dialog.getByLabel('Guestlist invitation link')).toHaveValue(/guestlistInvite=/);
});

test('analytics search is explicit, drills to purchases and customers, and exports every event', async ({ page, fixture }) => {
  // Exercise the standard download fallback, not an OS-native file-picker.
  await page.addInitScript(() => { delete window.showSaveFilePicker; });
  await login(page, fixture, 'business');
  await businessSection(page, 'Analytics');
  const search = page.getByLabel('Search business analytics');
  await expect(search).toBeVisible();
  await search.fill('Playwright Friday Night');
  await expect(page).not.toHaveURL(/reportSearch=/);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/reportSearch=Playwright/);
  const table = page.getByRole('table', { name: 'events report' });
  await table.getByRole('button', { name: 'Playwright Friday Night', exact: true }).click();
  await expect(page).toHaveURL(/reportTable=offerings/);
  await page.getByRole('table', { name: 'offerings report' }).getByRole('button', { name: 'General Admission', exact: true }).click();
  await expect(page).toHaveURL(/reportTable=customers/);
  await expect(page.getByRole('table', { name: 'customers report' })).toContainText('Jordan Customer');
  await page.goto('/app?section=analytics&reportTable=events');
  await expect(page.getByRole('table', { name: 'events report' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const file = await download;
  const content = await require('node:fs/promises').readFile(await file.path(), 'utf8');
  expect(content).toContain('Playwright Friday Night');
  expect(content).toContain('Playwright Night 12');
  expect(content.trim().split(/\r?\n/).length).toBeGreaterThan(10);
});

test('background exports show progress and remain downloadable after section navigation', async ({ page, fixture }) => {
  await page.addInitScript(() => { delete window.showSaveFilePicker; });
  let requested = false; let polls = 0;
  const job = { id: 'browser-export-fixture', status: 'queued', progress: 0, totalRows: 1200,
    processedRows: 0, filename: 'nitewide-customers.csv' };
  const ready = { ...job, status: 'ready', progress: 100, processedRows: 1200 };
  await page.route('**/api/business/reports/export.csv?**', async route => {
    requested = true;
    await route.fulfill({ status: 202, json: { data: job } });
  });
  await page.route('**/api/business/reports/exports', route => route.fulfill({ json: { data: requested ? [polls > 1 ? ready : job] : [] } }));
  await page.route('**/api/business/reports/exports/browser-export-fixture', route => route.fulfill({ json: {
    data: ++polls > 1 ? ready : { ...job, status: 'rendering', progress: 45, processedRows: 540 },
  } }));
  const csv = '"Customer","Sales USD"\r\n' + Array.from({ length: 1200 }, (_, i) => `"Buyer ${i}","25.00"\r\n`).join('');
  await page.route('**/api/business/reports/exports/browser-export-fixture/download', route => route.fulfill({
    contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="nitewide-customers.csv"' }, body: csv,
  }));
  await login(page, fixture, 'business');
  await businessSection(page, 'Analytics');
  await expect(page.getByRole('table', { name: 'regions report' })).toBeVisible();
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const prepared = page.getByTestId('prepared-exports');
  await prepared.locator('summary').click();
  await expect(prepared.getByRole('status')).toContainText('45%');
  const downloaded = await firstDownload;
  expect((await require('node:fs/promises').readFile(await downloaded.path(), 'utf8')).trim().split(/\r?\n/)).toHaveLength(1201);
  await expect(prepared.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  await businessSection(page, 'Events');
  await expect(prepared).toBeVisible();
  await expectNoOverflow(page);
  const secondDownload = page.waitForEvent('download');
  await prepared.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await secondDownload).suggestedFilename()).toBe('nitewide-customers.csv');
});

test('manual guestlist admission confirms once and updates customer entry', async ({ page, context, fixture }) => {
  await admissions(page, fixture);
  await page.getByRole('tab', { name: 'Manual check-in' }).click();
  const entry = page.getByTestId('admission-credential').filter({ hasText: fixture.ids.entry });
  await entry.getByRole('button', { name: 'Admit', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm entry', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmed', exact: true })).toContainText('3 guests admitted');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await entry.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Already admitted', exact: true })).toBeVisible();
  const customer = await context.newPage();
  await login(customer, fixture, 'customer');
  await customer.goto(`${urls.customer}/?tab=booked&booking=guestlist:${fixture.ids.entry}`);
  await expect(customer.getByText('Checked in', { exact: true })).toBeVisible();
  await expect(customer.getByText('1 of 1 checked in', { exact: true })).toBeVisible();
  await customer.close();
});

test('real QR photo decoding rejects fake and wrong-event codes then admits once', async ({ page, fixture }) => {
  await admissions(page, fixture);
  const upload = page.getByLabel('Scan QR photo');
  const scan = async token => {
    await expect(upload).toBeEnabled();
    // Use whole-pixel QR modules, not an arbitrary width that resamples dense
    // random signed payloads and can make an otherwise valid fixture unreadable.
    await upload.setInputFiles({ name: 'pass.png', mimeType: 'image/png', buffer: await QRCode.toBuffer(token, { scale: 8, margin: 4, errorCorrectionLevel: 'M' }) });
  };
  for (const token of ['fake-not-a-pass', fixture.wrongEventQr]) {
    await scan(token);
    await expect(page.getByRole('dialog', { name: 'Invalid', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await scan(fixture.ticketQr);
  await expect(page.getByRole('dialog', { name: 'Confirmed', exact: true })).toContainText('1 guest admitted');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await scan(fixture.ticketQr);
  await expect(page.getByRole('dialog', { name: 'Already admitted', exact: true })).toBeVisible();
});

test('promoter can access admissions for their assigned event', async ({ page, fixture }) => {
  await admissions(page, fixture, 'promoter');
  await page.getByRole('tab', { name: 'Manual check-in' }).click();
  await expect(page.getByTestId('admission-credential').first()).toBeVisible();
});

test('manage tiers opens offerings step, collapsed existing tiers and expanded new offering', async ({ page, fixture }) => {
  await eventDetails(page, fixture);
  await page.getByRole('tab', { name: 'Offerings', exact: true }).click();
  await page.getByRole('button', { name: 'Manage tiers', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Build your ticket ladder', { exact: true })).toBeVisible();
  const editors = dialog.getByTestId('offering-editor');
  await expect(editors).toHaveCount(2);
  await expect(editors.first()).not.toHaveAttribute('open');
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  await dialog.getByRole('button', { name: 'Add offering', exact: true }).click();
  const added = editors.last();
  await expect(added).toHaveAttribute('open', '');
  await added.getByLabel('Tier name', { exact: true }).fill('Browser VIP');
  await added.getByRole('combobox', { name: 'Type', exact: true }).click();
  await page.getByRole('option', { name: 'Package', exact: true }).click();
  await expect(added.getByRole('combobox', { name: 'Type', exact: true })).toContainText('Package');
  await added.getByRole('button', { name: 'Remove tier', exact: true }).click();
  await added.getByRole('button', { name: 'Remove tier', exact: true }).click();
  await expect(editors).toHaveCount(2);
});
