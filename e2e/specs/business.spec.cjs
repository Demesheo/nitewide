const { test, expect, login, loginViaApi, businessSection, expectNoOverflow } = require('../fixtures.cjs');
const { expectBrandImage, expectBrandIcons } = require('../brand-checks.cjs');
const QRCode = require('qrcode');
const { urls } = require('../environment.cjs');
const { requestFiveSpots, expectFourApprovedPasses } = require('../guestlist-quantity.cjs');
const { checkPasswordVisibility, checkOnboardingPasswords } = require('../password-visibility.cjs');
const { gestureClipboard, refusedClipboard } = require('../clipboard.cjs');

test('approved brand logo and favicon stay readable on business landing, sign in and workspace', async ({ page, fixture }) => {
  await page.goto('/');
  await expectBrandImage(page.locator('.lp-header .lp-brand img'));
  await expectBrandIcons(page);
  await expectNoOverflow(page);
  await test.info().attach('business-brand-landing', { body: await page.screenshot(), contentType: 'image/png' });
  await page.goto('/sign-in');
  await expectBrandImage(page.locator('.login-mark img'));
  if (page.viewportSize().width > 850) await expectBrandImage(page.locator('.signin-story .brand img'));
  await expectNoOverflow(page);
  await test.info().attach('business-brand-sign-in', { body: await page.screenshot(), contentType: 'image/png' });
  await login(page, fixture, 'business');
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
    await expectBrandImage(drawer.locator('.brand img'));
    await test.info().attach('business-brand-workspace', { body: await page.screenshot(), contentType: 'image/png' });
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  } else {
    await expectBrandImage(page.locator('.sidebar .brand img'));
    await test.info().attach('business-brand-workspace', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await expectBrandIcons(page);
  await expectNoOverflow(page);
});

test('business profile password change rotates the session and preserves workspace access', async ({ page, request, fixture }) => {
  await login(page, fixture, 'business');
  const oldToken = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nitewide.business.session')).accessToken);
  await page.getByRole('button', { name: 'Your profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toHaveCount(0);
  const originalNamePosition = await page.getByLabel('Name', { exact: true }).boundingBox();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  expect((await page.getByLabel('Name', { exact: true }).boundingBox()).y).toBeCloseTo(originalNamePosition.y, 0);
  const passwordForm = page.getByRole('form', { name: 'Change password' });
  if (page.viewportSize().width > 850) expect(await page.locator('.business-profile-dialog').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await expect(page.getByLabel('Current password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
  await page.getByLabel('Current password', { exact: true }).fill(fixture.password);
  await page.getByLabel('New password', { exact: true }).fill('UpdatedFixturePassword123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('Mismatch123');
  await expect(passwordForm.getByRole('button', { name: 'Change password', exact: true })).toBeDisabled();
  await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedFixturePassword123');
  await page.getByRole('button', { name: 'Show new password', exact: true }).click();
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('Current password', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Hide new password', exact: true }).click();
  await expectNoOverflow(page);
  await passwordForm.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Password changed. Other sessions have been signed out.' })).toBeVisible();
  const current = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nitewide.business.session')));
  expect(current.accessToken).not.toBe(oldToken);
  expect(JSON.stringify(current)).not.toContain('UpdatedFixturePassword123');
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(401);
  expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${current.accessToken}` } })).status()).toBe(200);
  await page.getByRole('button', { name: 'Your profile', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  for (const label of ['Current password', 'New password', 'Confirm new password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expectNoOverflow(page);
});

test('business profile incorrect current password is retryable and cancel clears secrets', async ({ page, fixture }) => {
  await login(page, fixture, 'business');
  await page.getByRole('button', { name: 'Your profile', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('IncorrectPassword123');
  await page.getByLabel('New password', { exact: true }).fill('UpdatedFixturePassword123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedFixturePassword123');
  await page.getByRole('form', { name: 'Change password' }).getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Current password is incorrect');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  for (const label of ['Current password', 'New password', 'Confirm new password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expectNoOverflow(page);
});

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
  await loginViaApi(page, fixture, 'business', 'business', `/app?section=events&event=${fixture.ids.event}`);
  await expect(page.getByRole('heading', { name: 'Playwright Friday Night', exact: true })).toBeVisible();
}
async function admissions(page, fixture, role = 'business') {
  const authenticate = role === 'promoter' ? login : loginViaApi;
  await authenticate(page, fixture, 'business', role, '/app?section=admissions');
  await page.getByRole('button', { name: 'Start admissions for Playwright Friday Night', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready at the door' })).toBeVisible();
}

test('promoter invitation links open Business, renew safely and allow the invited customer to accept', async ({ page, context, request, fixture }) => {
  await gestureClipboard(context, '__copiedTeamLink');
  await eventDetails(page, fixture);
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Add promoter', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add promoter', exact: true });
  await dialog.getByLabel('Email address', { exact: true }).fill(fixture.accounts.customer.email);
  await dialog.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const input = dialog.getByRole('textbox', { name: 'Invitation link', exact: true });
  await expect(input).toHaveValue(new RegExp(`^${urls.business}/app\\?invite=`));
  const original = await input.inputValue();
  await dialog.locator('li').filter({ hasText: fixture.accounts.customer.email }).getByRole('button', { name: 'Renew link', exact: true }).click();
  await expect(input).not.toHaveValue(original);
  await expect(input).toHaveValue(new RegExp(`^${urls.business}/app\\?invite=`));
  const renewed = await input.inputValue();
  const url = new URL(renewed);
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedTeamLink)).toBe(renewed);
  const mail = new URL(await dialog.getByRole('link', { name: 'Open email app', exact: true }).getAttribute('href'));
  expect(mail.searchParams.get('body')).toContain(renewed);
  expect((await request.get(`${urls.api}/api/team/invitations/${new URL(original).searchParams.get('invite')}`)).status()).toBe(404);
  const recipient = await context.newPage();
  try {
    for (const link of [renewed, `${urls.business}/${url.search}`]) {
      await recipient.goto(link);
      await expect(recipient.getByRole('heading', { name: 'Promote Playwright Friday Night', exact: true })).toBeVisible();
      await expect(recipient.getByLabel('Email', { exact: true })).toHaveValue(fixture.accounts.customer.email);
      await expect(recipient.getByRole('button', { name: 'Sign in and accept', exact: true })).toBeVisible();
      await expectNoOverflow(recipient);
    }
    // Viewing either path must not consume the invitation or grant access.
    expect((await request.get(`${urls.api}/api/team/invitations/${url.searchParams.get('invite')}`)).status()).toBe(200);
    await recipient.getByLabel('Password', { exact: true }).fill(fixture.password);
    await recipient.getByRole('button', { name: 'Sign in and accept', exact: true }).click();
    await expect(recipient.getByRole('heading', { name: 'Playwright Friday Night', exact: true })).toBeVisible();
    await expect(recipient).toHaveURL(new RegExp(`/app\\?.*event=${fixture.ids.event}`));
    await expectNoOverflow(recipient);
  } finally { await recipient.close(); }
});

test('organization invitation links and resend links open the team acceptance screen', async ({ page, context, request, fixture }, testInfo) => {
  await gestureClipboard(context, '__copiedTeamInviteLink');
  await loginViaApi(page, fixture, 'business', 'business', '/app?section=team');
  await page.getByRole('button', { name: 'Invite team member', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a team member', exact: true });
  await dialog.getByLabel('Name (optional)', { exact: true }).fill('Invited Customer');
  await dialog.getByLabel('Email', { exact: true }).fill(fixture.accounts.customer.email);
  await dialog.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const input = dialog.getByRole('textbox', { name: 'Invitation link', exact: true });
  await expect(input).toHaveValue(new RegExp(`^${urls.business}/app\\?invite=`));
  const copyInvite = dialog.getByRole('button', { name: 'Copy link', exact: true });
  await expect(copyInvite.locator('svg.lucide-copy')).toHaveCount(1);
  if (page.viewportSize().width > 850) {
    await copyInvite.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Copy link');
  }
  await copyInvite.click();
  await expect(dialog.getByRole('button', { name: 'Link copied', exact: true }).locator('svg.lucide-check')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__copiedTeamInviteLink)).toBe(await input.inputValue());
  const original = await input.inputValue();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  const pending = page.locator('.team-pending li').filter({ hasText: fixture.accounts.customer.email });
  await expect(pending.locator('strong')).toHaveText('Invited Customer');
  await expectNoOverflow(page);
  const copyPending = pending.getByRole('button', { name: 'Copy link', exact: true });
  const resend = pending.getByRole('button', { name: 'Resend', exact: true });
  const remove = pending.getByRole('button', { name: 'Delete', exact: true });
  await expect(remove).toHaveCSS('border-top-width', '1px');
  expect((await remove.boundingBox()).x).toBeLessThan((await resend.boundingBox()).x);
  expect((await copyPending.boundingBox()).y).toBeLessThan((await resend.boundingBox()).y);
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoOverflow(page);
  await page.setViewportSize(originalViewport);
  await copyPending.click();
  await expect(pending.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__copiedTeamInviteLink)).not.toBe(original);
  const pendingLink = await page.evaluate(() => window.__copiedTeamInviteLink);
  const copiedToken = new URL(pendingLink).searchParams.get('invite');
  expect(copiedToken).toMatch(/^nwti1\./);
  const preview = await request.get(`${urls.api}/api/team/invitations/${copiedToken}`);
  expect(preview.status()).toBe(200);
  expect((await preview.json()).data.email).toBe(fixture.accounts.customer.email);
  const tamperedToken = copiedToken.slice(0, -1) + (copiedToken.endsWith('A') ? 'B' : 'A');
  expect((await request.get(`${urls.api}/api/team/invitations/${tamperedToken}`)).status()).toBe(404);
  await testInfo.attach('pending-team-invitation', { body: await pending.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await resend.click();
  await expect(dialog).toBeVisible();
  await expect(input).not.toHaveValue(original);
  await expect(input).toHaveValue(new RegExp(`^${urls.business}/app\\?invite=`));
  const renewed = await input.inputValue();
  expect((await request.get(`${urls.api}/api/team/invitations/${new URL(original).searchParams.get('invite')}`)).status()).toBe(404);
  expect((await request.get(`${urls.api}/api/team/invitations/${copiedToken}`)).status()).toBe(404);
  const recipient = await context.newPage();
  try {
    await recipient.goto(renewed);
    await expect(recipient.getByRole('heading', { name: 'Playwright Nightlife invited you to join as employee', exact: true })).toBeVisible();
    await expect(recipient.getByLabel('Email', { exact: true })).toHaveValue(fixture.accounts.customer.email);
    await expectNoOverflow(recipient);
    await testInfo.attach('team-invitation-acceptance', { body: await recipient.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    const viewport = recipient.viewportSize();
    await recipient.setViewportSize({ width: 320, height: 568 });
    await expectNoOverflow(recipient);
    await recipient.setViewportSize(viewport);
    await recipient.getByRole('button', { name: 'New to Nitewide? Create an account', exact: true }).click();
    await expect(recipient.getByLabel('Name', { exact: true })).toBeVisible();
    await expect(recipient.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
    await expectNoOverflow(recipient);
    await testInfo.attach('team-invitation-create-account', { body: await recipient.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  } finally { await recipient.close(); }
});

test('clipboard refusal offers a selectable referral link without claiming copy success', async ({ page, context, fixture }, testInfo) => {
  await refusedClipboard(context);
  await eventDetails(page, fixture);
  const share = page.locator('.guestlist-referral-card');
  await share.getByRole('button', { name: 'Copy link', exact: true }).click();
  const manual = share.getByRole('textbox', { name: 'Copy link manually', exact: true });
  await expect(manual).toBeVisible();
  await expect(manual).toHaveAttribute('readonly', '');
  const link = await manual.inputValue();
  expect(new URL(link).searchParams.get('event')).toBe(fixture.ids.event);
  await manual.click();
  await expect.poll(() => manual.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([0, link.length]);
  await expect(share).not.toContainText('Allow clipboard access');
  await expect(share.getByRole('button', { name: 'Copied', exact: true })).toHaveCount(0);
  await expectNoOverflow(page);
  await testInfo.attach('business-manual-copy-fallback', { body: await page.screenshot(), contentType: 'image/png' });
});

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
  await loginViaApi(page, fixture, 'business');
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

test('business reviewer adjusts a five-spot request to four separate passes and a matching notification', async ({ page, browser, request, fixture }, testInfo) => {
  const customer = await requestFiveSpots({ browser, page, request, fixture, testInfo });
  try {
    await eventDetails(page, fixture);
    await page.getByRole('tab', { name: 'Guestlist', exact: true }).click();
    await page.getByRole('button', { name: 'Pending Guest', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Pending Guest', exact: true });
    const spots = details.getByRole('spinbutton', { name: 'Approved spots', exact: true });
    await expect(spots).toHaveAttribute('aria-valuenow', '5');
    await details.getByRole('button', { name: 'Decrease approved spots', exact: true }).click();
    await expect(spots).toHaveAttribute('aria-valuenow', '4');
    await expectNoOverflow(page);
    const screenshot = testInfo.outputPath('business-adjust-approval.png');
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('business-adjust-approval', { path: screenshot, contentType: 'image/png' });
    const reviewed = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/guestlist/${customer.entry.id}/decision`));
    await details.getByRole('button', { name: 'Approve', exact: true }).click();
    const response = await reviewed;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({ decision: 'approve', partySize: 4 });
    await expect(details).toHaveCount(0);
    await expectFourApprovedPasses(customer, fixture, testInfo);
  } finally { await customer.context.close(); }
});

test('manager personal invitation opens four account-free individual passes and can be copied again', async ({ page, context, fixture }, testInfo) => {
  const linkRequests = [];
  page.on('request', request => { if (/\/(referral-link|invitation-link)(?:\?|$)/.test(request.url())) linkRequests.push(request.url()); });
  await gestureClipboard(context, '__copiedGuestlistLink');
  await eventDetails(page, fixture);
  const share = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Your referral link', exact: true }) }).last();
  await expect(share.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await share.getByRole('button', { name: 'Invite guest', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite to guestlist', exact: true });
  await expect(dialog.getByLabel('Invite by')).toHaveValue('personal');
  await expect(dialog.getByLabel('Invite by')).toBeDisabled();
  await dialog.getByLabel('Guestlist pool').selectOption({ label: 'My allocation · 10 places' });
  await dialog.getByLabel('Guest name').fill('Alex and friends');
  await expect(dialog.getByLabel('Phone number')).toHaveCount(0);
  await expect(dialog.getByLabel('Email address')).toHaveCount(0);
  await dialog.getByLabel('Spots').fill('4');
  await expectNoOverflow(page);
  const formBounds = await dialog.boundingBox();
  expect(formBounds.width).toBeLessThanOrEqual(540);
  expect(formBounds.height).toBeLessThanOrEqual(page.viewportSize().height - 30);
  if (page.viewportSize().width < 480) {
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 320, height: viewport.height });
    await expectNoOverflow(page);
    await expect(dialog.getByRole('button', { name: 'Create invitation', exact: true })).toBeInViewport();
    await page.setViewportSize(viewport);
  }
  await testInfo.attach('guestlist-invitation-form', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await dialog.getByRole('button', { name: /Create invitation|Invite guest|Send invite/ }).click();
  await expect(dialog).toContainText('4 spots approved');
  await expect(dialog.getByRole('heading', { name: 'Alex and friends', exact: true })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Invitation summary' })).toContainText('4 separate passes');
  await expect(dialog.getByRole('region', { name: 'Invitation summary' })).toContainText('My allocation');
  await expect(dialog.getByRole('button', { name: 'Copy link', exact: true })).toBeFocused();
  await testInfo.attach('guestlist-invitation-success', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await expect(dialog.locator('input')).toHaveCount(0);
  await dialog.getByRole('button',{ name: 'Copy link',exact: true }).click();
  await expect(dialog.getByRole('button',{ name: 'Link copied',exact: true })).toBeVisible();
  const link = await page.evaluate(() => window.__copiedGuestlistLink);
  expect(new URL(link).searchParams.has('guestlistInvite')).toBe(true);
  await expectNoOverflow(page);
  await dialog.getByRole('button',{ name: 'Close',exact: true }).click();
  await page.getByRole('tab',{ name: 'Guestlist',exact: true }).click();
  // Guest experience defaults to pending requests; include approved invites.
  await page.getByRole('button',{ name: /Request status/ }).click();
  await page.getByRole('checkbox',{ name: 'Approved',exact: true }).check();
  await page.getByRole('button',{ name: /Request status/ }).click();
  await expect(page.locator('.guest-experience-content').getByRole('button', { name: /Copy link/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Alex and friends', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Alex and friends', exact: true });
  const copyAgain = details.getByRole('button',{ name: 'Copy link',exact: true });
  await expect(copyAgain).toBeEnabled();
  const prefetchedRequests = linkRequests.length;
  const copyBounds = await copyAgain.boundingBox(), revokeBounds = await details.getByRole('button', { name: 'Revoke approval', exact: true }).boundingBox();
  expect(revokeBounds.x + revokeBounds.width).toBeLessThanOrEqual(copyBounds.x);
  await expect(details.locator('.guestlist-detail-actions').getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
  await copyAgain.click();
  await expect(details.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__copiedGuestlistLink)).toBe(link);
  expect((await page.evaluate(() => window.__clipboardWrites)).immediate).toBeGreaterThan(0);
  expect(linkRequests).toHaveLength(prefetchedRequests);
  await expectNoOverflow(page);
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.getByRole('heading',{ name: "You're on the list, Alex and friends." })).toBeVisible();
  await expect(guest.getByRole('dialog')).toHaveCount(0);
  await expect(guest.locator('.pass-pager')).toContainText('Pass 1 of 4');
  const qr = guest.getByRole('img',{ name: /QR code for guest list pass/ });
  const codes = [];
  for (let index = 0; index < 4; index++) {
    await expect(guest.locator('.pass-pager')).toContainText(`Pass ${index+1} of 4`);
    await expect(qr).toBeVisible(); codes.push(await qr.getAttribute('src'));
    await expectNoOverflow(guest);
    if (index < 3) await guest.getByRole('button',{ name: 'Next pass' }).click();
  }
  expect(new Set(codes).size).toBe(4);
  await testInfo.attach('account-free-guestlist-passes',{ body: await guest.screenshot(),contentType: 'image/png' });
  await guest.close();
});

test('guestlist invitation copy failure can retry and Done resets the form for the next guest', async ({ page, context, fixture }, testInfo) => {
  await context.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {
      if (++attempts === 1) throw new Error('Clipboard unavailable');
    } } });
    document.execCommand = () => false;
  });
  await eventDetails(page, fixture);
  await page.getByRole('button', { name: 'Invite guest', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite to guestlist', exact: true });
  const name = 'Alexandra Rivera and friends visiting for a birthday celebration';
  await dialog.getByLabel('Guest name').fill(name);
  await dialog.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(dialog).toContainText('1 spot approved');
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Invitation summary' })).toContainText('1 individual pass');
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Automatic copying is unavailable');
  await expect(dialog.getByRole('textbox', { name: 'Copy link manually' })).toBeVisible();
  await expectNoOverflow(page);
  await testInfo.attach('guestlist-invitation-copy-retry', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite guest', exact: true }).click();
  await expect(dialog.getByLabel('Guest name')).toHaveValue('');
  await expect(dialog.getByLabel('Spots')).toHaveValue('1');
  await expect(dialog.getByLabel('Invite by')).toHaveValue('personal');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('analytics chart labels are readable and tooltips show Sales instead of the internal cents field', async ({ page, fixture }, testInfo) => {
  // Keep real report values, but exercise a name that would overflow a
  // character-count truncation rule. No database records are changed.
  const longName = 'WWWWWWWWWWWWWWWWWWWW — exceptionally long event name';
  await page.route('**/api/business/reports/summary?**', async route => {
    const response = await route.fetch();
    const json = await response.json();
    if (json.data?.eventMix) json.data.eventMix = json.data.eventMix.map(row => ({ ...row, label: longName }));
    await route.fulfill({ response, json });
  });
  await loginViaApi(page, fixture, 'business', 'business', '/app?section=analytics');
  for (const title of ['Sales pace', 'Top events']) {
    const chart = page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const surface = chart.getByRole('application');
    await expect(surface).toBeVisible();
    // Keyboard activation exposes the actual Recharts tooltip in both
    // browsers, without depending on tiny point coordinates or hover support.
    await surface.focus();
    await surface.press('ArrowRight');
    const tooltip = chart.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.recharts-tooltip-item-name')).toHaveText('Sales');
    await expect(tooltip.locator('.recharts-tooltip-item-value')).toHaveText(/^\$[\d,]+\.\d{2}$/);
    await expect(tooltip).not.toContainText('salesCents');
    await expect(tooltip.locator('.recharts-default-tooltip')).toHaveCSS('background-color', 'rgb(32, 32, 44)');
    await expect(tooltip.locator('.recharts-tooltip-item')).toHaveCSS('color', 'rgb(250, 250, 250)');
    if (title === 'Top events') await expect(tooltip).toContainText(longName);
    const tooltipBox = await tooltip.boundingBox();
    expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(page.viewportSize().width);
    const axes = await chart.locator('.recharts-cartesian-axis-tick-labels').evaluateAll(elements => elements.map(axis => {
      const svg = axis.closest('svg').getBoundingClientRect();
      const labels = [...axis.querySelectorAll('text')].map(text => {
        const rect = text.getBoundingClientRect();
        const style = getComputedStyle(text);
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, fontSize: style.fontSize, fill: style.fill };
      });
      return { horizontal: axis.classList.contains('recharts-xAxis-tick-labels'), svg: { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom }, labels };
    }));
    for (const { horizontal, svg, labels } of axes) {
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label.fontSize).toBe('12px');
        expect(label.fill).toBe('rgb(216, 209, 225)');
        expect(label.left).toBeGreaterThanOrEqual(svg.left - 1);
        expect(label.right).toBeLessThanOrEqual(svg.right + 1);
      }
      const ordered = labels.toSorted((a, b) => horizontal ? a.left - b.left : a.top - b.top);
      for (let index = 1; index < ordered.length; index += 1) {
        expect(horizontal ? ordered[index].left : ordered[index].top).toBeGreaterThanOrEqual(horizontal ? ordered[index - 1].right : ordered[index - 1].bottom);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`${title.toLowerCase().replaceAll(' ', '-')}.png`) });
  }
  await expectNoOverflow(page);
});

test('analytics search is explicit, drills to purchases and customers, and exports every event', async ({ page, fixture }) => {
  // Exercise the standard download fallback, not an OS-native file-picker.
  await page.addInitScript(() => { delete window.showSaveFilePicker; });
  await loginViaApi(page, fixture, 'business', 'business', '/app?section=analytics');
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
  const startDate = await page.getByLabel('Start date', { exact: true }).inputValue();
  const endDate = await page.getByLabel('End date', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('table', { name: 'regions report' })).toBeVisible();
  await expect(page).not.toHaveURL(/reportEvent=|reportOffering|reportSearch=|reportPerson=|venueIds=/);
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue(startDate);
  await expect(page.getByLabel('End date', { exact: true })).toHaveValue(endDate);
  await expect(search).toHaveValue('');
  const views = page.getByRole('group', { name: 'Analytics report views', exact: true });
  await expect(views.getByRole('button', { name: 'Regions', exact: true })).toHaveCount(0);
  await expect(views.getByRole('button', { name: 'Customers', exact: true })).toBeVisible();
  await views.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('table', { name: 'customers report' })).toContainText('Jordan Customer');
  await expect(views.getByRole('button', { name: 'Customers', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/reportEvent=|reportOffering|reportPerson=/);
  await expectNoOverflow(page);
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
  let exportsRequested = 0, polls = 0, downloadsRequested = 0;
  const job = { id: 'browser-export-fixture', status: 'queued', progress: 0, totalRows: 1200,
    processedRows: 0, filename: 'nitewide-customers.csv' };
  const ready = { ...job, status: 'ready', progress: 100, processedRows: 1200 };
  let currentJob = job;
  await page.route('**/api/business/reports/export.csv?**', async route => {
    exportsRequested += 1;
    await route.fulfill({ status: 202, json: { data: job } });
  });
  await page.route('**/api/business/reports/exports', route => route.fulfill({ json: { data: exportsRequested ? [currentJob] : [] } }));
  await page.route('**/api/business/reports/exports/browser-export-fixture', route => {
    polls += 1;
    return route.fulfill({ json: { data: currentJob } });
  });
  const csv = '"Customer","Sales USD"\r\n' + Array.from({ length: 1200 }, (_, i) => `"Buyer ${i}","25.00"\r\n`).join('');
  await page.route('**/api/business/reports/exports/browser-export-fixture/download', route => {
    downloadsRequested += 1;
    return route.fulfill({ contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="nitewide-customers.csv"' }, body: csv });
  });
  await login(page, fixture, 'business');
  await businessSection(page, 'Analytics');
  await expect(page.getByRole('table', { name: 'regions report' })).toBeVisible();
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const prepared = page.getByTestId('prepared-exports');
  await prepared.locator('summary').click();
  await expect(prepared.getByRole('status')).toHaveText('Queued…');
  // Hold each state until its UI assertion completes; browser speed cannot
  // skip the rendering state or spend the download budget on preparation.
  currentJob = { ...job, status: 'rendering', progress: 45, processedRows: 540 };
  await expect(prepared.getByRole('status')).toContainText('45%');
  await businessSection(page, 'Events');
  await expect(prepared).toBeVisible();
  await expect(prepared.getByRole('status')).toContainText('45%');
  await expectNoOverflow(page);
  const firstDownload = page.waitForEvent('download');
  currentJob = ready;
  const downloaded = await firstDownload;
  expect(downloaded.suggestedFilename()).toBe('nitewide-customers.csv');
  expect((await require('node:fs/promises').readFile(await downloaded.path(), 'utf8')).trim().split(/\r?\n/)).toHaveLength(1201);
  await expect(prepared.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  await expect(prepared.getByRole('status')).toHaveText('1,200 rows · Ready');
  await businessSection(page, 'Analytics');
  await expect(prepared).toBeVisible();
  await expectNoOverflow(page);
  const [secondDownload] = await Promise.all([
    page.waitForEvent('download'), prepared.getByRole('button', { name: 'Download', exact: true }).click(),
  ]);
  expect(secondDownload.suggestedFilename()).toBe('nitewide-customers.csv');
  expect(await require('node:fs/promises').readFile(await secondDownload.path(), 'utf8')).toBe(csv);
  expect(exportsRequested).toBe(1);
  expect(polls).toBeGreaterThanOrEqual(2);
  expect(downloadsRequested).toBe(2);
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
  await loginViaApi(customer, fixture, 'customer', 'customer', `/?tab=booked&booking=guestlist:${fixture.ids.entry}`);
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
