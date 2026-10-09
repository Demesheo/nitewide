const { test: baseTest, expect, loginViaApi, expectNoOverflow } = require('../fixtures.cjs');
const test = baseTest.extend({ fixtureRecipe: 'commerce' });
const authTest = baseTest.extend({ fixtureRecipe: 'customer-auth' });
const { urls } = require('../environment.cjs');
const { checkPasswordVisibility } = require('../password-visibility.cjs');

authTest('profile lifecycle preserves failed changes, rotates passwords and saves independent contact preferences', async ({ page, request, fixture }) => {
  await loginViaApi(page, fixture, 'customer');
  const oldToken = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
  await expect(page.locator('.site-header').getByRole('link', { name: 'For business' })).toHaveCount(0);
  await expect(page.locator('.site-footer')).not.toContainText('Orlando · Miami');
  await expect(page.locator('.site-footer').getByRole('link', { name: 'For business' })).toBeVisible();
  await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toHaveCount(0);
  // Compare position in the dialog's content, not the viewport: on iPhone,
  // reaching the Change password button naturally scrolls the dialog.
  const contactPosition = () => page.getByLabel('Display name', { exact: true }).evaluate((element) => {
    const dialog = element.closest('.account-modal');
    const field = element.getBoundingClientRect();
    return { top: field.top - dialog.getBoundingClientRect().top + dialog.scrollTop, width: field.width };
  });
  const originalNamePosition = await contactPosition();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const expandedNamePosition = await contactPosition();
  expect(expandedNamePosition.top).toBeCloseTo(originalNamePosition.top, 0);
  expect(expandedNamePosition.width).toBeCloseTo(originalNamePosition.width, 0);
  const passwordForm = page.getByRole('form', { name: 'Change password' });
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  if (page.viewportSize().width > 850) expect(await page.locator('.account-modal').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await test.step('incorrect password keeps the session; closing clears unsaved secrets', async () => {
    await page.getByLabel('Current password', { exact: true }).fill('WrongPassword123');
    await page.getByLabel('New password', { exact: true }).fill('UpdatedFixturePassword123');
    await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedFixturePassword123');
    await passwordForm.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Current password is incorrect');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken)).toBe(oldToken);
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    for (const label of ['Current password', 'New password', 'Confirm new password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
    await expectNoOverflow(page);
  });
  await test.step('validated password rotation revokes the old session and clears secrets', async () => {
    await page.getByLabel('Current password', { exact: true }).fill(fixture.password);
    await page.getByLabel('New password', { exact: true }).fill('UpdatedFixturePassword123');
    await page.getByLabel('Confirm new password', { exact: true }).fill('Mismatch123');
    await expect(passwordForm.getByRole('button', { name: 'Change password', exact: true })).toBeDisabled();
    await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedFixturePassword123');
    await page.getByRole('button', { name: 'Show new password', exact: true }).click();
    await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('Confirm new password', { exact: true })).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Hide new password', exact: true }).click();
    await passwordForm.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Password changed. Other sessions have been signed out.' })).toBeVisible();
    const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
    expect(fresh).not.toBe(oldToken);
    expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(401);
    expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${fresh}` } })).status()).toBe(200);
    await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    for (const label of ['Current password', 'New password', 'Confirm new password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
    await expectNoOverflow(page);
  });
  await test.step('contact details and preferences save without another password change', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
    await expect(page.getByLabel('Display name', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Display name', { exact: true }).fill('Jordan Updated');
    await page.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect(page.getByLabel('Display name', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Jordan Updated');
    await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Your preferences are updated.' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: "Open Jordan Updated's profile" }).click();
    await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Jordan Updated');
  });
  await expectNoOverflow(page);
});

authTest('sign-in recovery persists across reload, retains failed logout and revokes all sessions', async ({ page, request, fixture }) => {
  await test.step('invalid credentials can be corrected in the same sign-in form', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    const authActions = [];
    const observeAuth = request => { if (request.method() === 'POST' && request.url().includes('/api/auth/')) authActions.push(request.url()); };
    page.on('request', observeAuth);
    await checkPasswordVisibility(page, 'Password');
    expect(authActions).toEqual([]);
    page.off('request', observeAuth);
    await page.getByLabel('Email address').fill(fixture.accounts.customer.email);
    await page.getByLabel('Password', { exact: true }).fill('WrongPassword!2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/password|credentials|incorrect|invalid/i);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: "Open Jordan Customer's profile" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: "Open Jordan Customer's profile" })).toBeVisible();
    await expectNoOverflow(page);
  });
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
  const second = await request.post(`${urls.api}/api/auth/sign-in`, { data: { email: fixture.accounts.customer.email, password: fixture.password } });
  const other = (await second.json()).data.accessToken;
  await page.getByRole('button', { name: "Open Jordan Customer's profile" }).click();
  await test.step('failed logout cannot silently erase an active session', async () => {
    await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Security controls are temporarily unavailable. Please try again.' } }) }));
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Security controls are temporarily unavailable');
    expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken)).toBe(token);
  });
  await test.step('sign out everywhere revokes both real API sessions', async () => {
    await page.getByRole('button', { name: 'Sign out everywhere', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
    for (const revoked of [token, other]) expect((await request.get(`${urls.api}/api/auth/me`, { headers: { Authorization: `Bearer ${revoked}` } })).status()).toBe(401);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')))).toBeNull();
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
});

authTest('registration requires matching passwords and creates a real account', async ({ page, fixture }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Browser New Customer');
  await page.getByLabel('Email address', { exact: true }).fill('new@playwright.nitewide.test');
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByLabel('Confirm password', { exact: true }).fill('DoesNotMatch!2026');
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled();
  await page.getByLabel('Confirm password', { exact: true }).fill(fixture.password);
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: /terms and conditions of use/ }).click();
  const terms = page.getByRole('dialog', { name: 'Nitewide Terms and Conditions of Use' });
  await expect(terms.getByRole('heading', { name: 'Nitewide Terms and Conditions of Use' })).toBeFocused();
  await expect(terms.getByRole('region', { name: 'Terms and conditions document' })).toContainText('30-DAY OPT-OUT');
  await expectNoOverflow(page);
  await terms.getByRole('button', { name: 'Back to form' }).click();
  await test.step('public privacy opens separately without accepting consent or losing the signup draft', async () => {
    const link = page.getByRole('link', { name: 'Privacy Policy', exact: true });
    await expect(link).toHaveAttribute('href', `${urls.customer}/privacy`);
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const privacy = await popupPromise;
    try {
      await expect(privacy.getByRole('heading', { name: 'Nitewide Privacy Policy', exact: true })).toBeVisible();
      await expectNoOverflow(privacy);
    } finally { await privacy.close(); }
    await expect(page.getByRole('checkbox', { name: /acknowledge the Privacy Policy/ })).not.toBeChecked();
    await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Browser New Customer');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(fixture.password);
  });
  await expect(page.getByRole('checkbox', { name: /I agree to the terms/ })).not.toBeChecked();
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Browser New Customer');
  await page.getByRole('checkbox', { name: /I agree to the terms/ }).check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: "Open Browser New Customer's profile" })).toBeVisible();
});
