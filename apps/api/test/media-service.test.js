const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { randomBytes } = require('node:crypto');
const {
  normalizeImage,
  MAX_IMAGE_BYTES,
} = require("../src/services/media-service");
test("valid artwork is resized, converted to WebP, and stripped of metadata", async () => {
  const original = await sharp({
    create: { width: 1800, height: 2700, channels: 3, background: "#1C1859" },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const normalized = await normalizeImage(original);
  const metadata = await sharp(normalized.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 2400);
  assert.equal(metadata.exif, undefined);
});
test("invalid, SVG, oversized, and tiny files are rejected", async () => {
  await assert.rejects(() => normalizeImage(Buffer.from("not a jpeg")), {
    code: "INVALID_IMAGE",
  });
  await assert.rejects(
    () =>
      normalizeImage(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"></svg>',
        ),
      ),
    { code: "INVALID_IMAGE" },
  );
  await assert.rejects(
    () => normalizeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1)),
    /10 MB/,
  );
  const tiny = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  await assert.rejects(() => normalizeImage(tiny), { code: "INVALID_IMAGE" });
});
test('valid images larger than the old 5 MB limit and below 10 MB are accepted', async () => {
  const png = await sharp(randomBytes(1500 * 1500 * 3), { raw: { width: 1500, height: 1500, channels: 3 } }).png().toBuffer();
  assert.ok(png.length > 5 * 1024 * 1024); assert.ok(png.length < MAX_IMAGE_BYTES);
  const normalized = await normalizeImage(png); assert.equal(normalized.info.format, 'webp');
});
