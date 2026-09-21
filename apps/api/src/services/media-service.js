const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { DomainError } = require("../domain/errors");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const defaultUploadDir = path.resolve(__dirname, "../../uploads/events");
async function normalizeImage(buffer) {
  if (!buffer?.length || buffer.length > MAX_IMAGE_BYTES)
    throw new DomainError("Choose a JPG, PNG, or WebP image up to 10 MB", {
      status: 422,
    });
  try {
    const source = sharp(buffer, {
      limitInputPixels: 20_000_000,
      failOn: "warning",
    });
    const meta = await source.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format) ||
      (meta.pages || 1) !== 1
    )
      throw new Error("Unsupported image");
    if (meta.width < 128 || meta.height < 128)
      throw new Error("Image too small");
    return await source
      .rotate()
      .resize({
        width: 1600,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new DomainError(
      "Use a valid, static JPG, PNG, or WebP image: at least 128 × 128 pixels and at most 20 megapixels",
      { code: "INVALID_IMAGE", status: 422 },
    );
  }
}
function createMediaService({ models, uploadDir = defaultUploadDir }) {
  async function upload(userId, buffer) {
    const count = await models.MediaAsset.count({
      where: { uploadedByUserId: userId },
    });
    if (count >= 200)
      throw new DomainError(
        "Your upload allowance is reached. Contact support before uploading more artwork.",
        { status: 429, code: "UPLOAD_LIMIT" },
      );
    const { data, info } = await normalizeImage(buffer);
    const id = randomUUID();
    const storageKey = `${id}.webp`;
    await fs.mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, storageKey);
    await fs.writeFile(filePath, data, { flag: "wx" });
    try {
      const asset = await models.MediaAsset.create({
        id,
        uploadedByUserId: userId,
        storageKey,
        mimeType: "image/webp",
        sizeBytes: data.length,
        width: info.width,
        height: info.height,
      });
      return {
        id: asset.id,
        url: `/api/media/images/${asset.id}`,
        width: info.width,
        height: info.height,
      };
    } catch (error) {
      await fs.unlink(filePath);
      throw error;
    }
  }
  return { upload, uploadDir };
}
module.exports = {
  createMediaService,
  normalizeImage,
  MAX_IMAGE_BYTES,
  defaultUploadDir,
};
