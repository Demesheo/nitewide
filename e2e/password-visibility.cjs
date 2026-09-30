const { expect } = require('@playwright/test');

async function checkPasswordVisibility(page, label, toggleLabel = 'password') {
  const input = page.getByLabel(label, { exact: true });
  await input.fill('SyntheticPass123!');
  await expect(input).toHaveAttribute('type', 'password');
  const show = page.getByRole('button', { name: `Show ${toggleLabel}`, exact: true });
  await expect(show.locator('svg.lucide-eye')).toBeVisible();
  const fieldBounds = await input.boundingBox();
  const buttonBounds = await show.boundingBox();
  expect(buttonBounds.x).toBeGreaterThan(fieldBounds.x + fieldBounds.width / 2);
  expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(fieldBounds.x + fieldBounds.width + 1);
  expect(buttonBounds.y).toBeGreaterThanOrEqual(fieldBounds.y - 1);
  expect(buttonBounds.y + buttonBounds.height).toBeLessThanOrEqual(fieldBounds.y + fieldBounds.height + 1);
  expect(await input.evaluate(element => parseFloat(getComputedStyle(element).paddingRight))).toBeGreaterThanOrEqual(buttonBounds.width);
  await show.click();
  await expect(input).toHaveAttribute('type', 'text');
  const hide = page.getByRole('button', { name: `Hide ${toggleLabel}`, exact: true });
  await expect(hide.locator('svg.lucide-eye-off')).toBeVisible();
  await expect(input).toHaveValue('SyntheticPass123!');
  await hide.press('Space');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveValue('SyntheticPass123!');
}

async function checkOnboardingPasswords(page, path = '/') {
  await page.route('**/api/auth/onboarding/preview?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: {
    displayName: 'Visibility Test', email: 'visibility@playwright.nitewide.test', kind: 'user', accountMode: 'new', expiresAt: '2030-01-01T00:00:00Z',
  } }) }));
  await page.goto(`${path}?onboarding=synthetic-visibility-token`);
  await checkPasswordVisibility(page, /^New password/);
  await checkPasswordVisibility(page, 'Confirm password', 'confirmed password');
  await expect(page.getByLabel(/^New password/)).toHaveAttribute('type', 'password');
}

module.exports = { checkPasswordVisibility, checkOnboardingPasswords };
