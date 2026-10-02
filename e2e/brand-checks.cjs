const { expect } = require('@playwright/test');

async function expectBrandImage(image, { maxSize = 48 } = {}) {
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('alt', '');
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth === 192 && node.naturalHeight === 192)).toBe(true);
  const bounds = await image.boundingBox();
  expect(bounds.width).toBeGreaterThanOrEqual(20);
  expect(bounds.width).toBeLessThanOrEqual(maxSize);
  expect(bounds.height).toBeCloseTo(bounds.width, 0);
}

async function expectBrandIcons(page) {
  for (const [rel, size] of [['icon', 64], ['apple-touch-icon', 180]]) {
    const link = page.locator(`head link[rel="${rel}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('sizes', `${size}x${size}`);
    const href = await link.getAttribute('href');
    const response = await page.request.get(new URL(href, page.url()).toString());
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/image\/png/);
    const bytes = await response.body();
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
}
module.exports = { expectBrandImage, expectBrandIcons };
