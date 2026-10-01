const { mutationTransaction } = require('./mutation-transaction');
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { DomainError } = require("../domain/errors");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const { createMediaStorage, defaultUploadDir, digest } = require('../storage/media-storage');
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
function createMediaService({ models, uploadDir, config = {}, storage = createMediaStorage({ config, uploadDir }) }) {
  const storageUnavailable = () => new DomainError('Artwork storage is temporarily unavailable. Please retry.', { status: 503, code: 'MEDIA_STORAGE_UNAVAILABLE' });
  async function finalize(userId, id) {
    const pending = await models.MediaAsset.findByPk(id);
    if (!pending || pending.uploadedByUserId !== userId) throw new DomainError('Image not found', { status: 404 });
    let actual;
    try { actual = await storage.forAsset(pending).head(pending); } catch { throw storageUnavailable(); }
    if (actual.sizeBytes !== pending.sizeBytes || actual.mimeType !== 'image/webp' || actual.sha256 !== pending.sha256 ||
      (pending.storageProvider === 'r2' && actual.assetId !== pending.id)) throw new DomainError('Uploaded artwork could not be verified. Please upload it again.', { status: 422, code: 'MEDIA_VERIFICATION_FAILED' });
    return mutationTransaction(models.MediaAsset.sequelize, async transaction => {
      require('./lifecycle-service').assertActiveUser(await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE }));
      const asset = await models.MediaAsset.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!asset || !['pending', 'ready'].includes(asset.status)) throw new DomainError('Image upload expired. Please upload it again.', { status: 409, code: 'MEDIA_UPLOAD_EXPIRED' });
      if (asset.status === 'pending') await asset.update({ status: 'ready', lastStorageError: null, cleanupAfter: new Date(Date.now() + 86400000) }, { transaction });
      return { id: asset.id, url: `/api/media/images/${asset.id}`, width: asset.width, height: asset.height };
    });
  }
  async function upload(userId, buffer) {
    const { data, info } = await normalizeImage(buffer);
    const id = randomUUID();
    const storageKey = storage.provider === 'r2' ? `events/${id}.webp` : `${id}.webp`;
    // Reserve before PUT: a crash never leaves an untracked managed object.
    const asset = await mutationTransaction(models.MediaAsset.sequelize, async (transaction) => {
        // Serialize this uploader's quota; image processing stays outside locks.
        require('./lifecycle-service').assertActiveUser(await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE }));
        const count = await models.MediaAsset.count({ where: { uploadedByUserId: userId }, transaction });
        if (count >= 200) throw new DomainError('Your upload allowance is reached. Contact support before uploading more artwork.', { status: 429, code: 'UPLOAD_LIMIT' });
        return models.MediaAsset.create({
        id,
        uploadedByUserId: userId,
        storageKey,
        storageProvider: storage.provider,
        storageBucket: storage.bucket,
        status: 'pending', managedUpload: true, sha256: digest(data),
        mimeType: "image/webp",
        sizeBytes: data.length,
        width: info.width,
        height: info.height,
        }, { transaction });
      });
    try { await storage.forAsset(asset).put(asset, data); }
    catch {
      await asset.update({ lastStorageError: 'UPLOAD_FAILED' }).catch(() => {});
      throw storageUnavailable();
    }
    return finalize(userId, asset.id);
  }
  async function resolve(id) {
    const asset = await models.MediaAsset.findByPk(id);
    if (!asset || asset.status !== 'ready') return null;
    try {
      const adapter = storage.forAsset(asset);
      return adapter.provider === 'r2' ? { url: await adapter.accessUrl(asset) } : { filePath: adapter.filePath(asset) };
    } catch { throw storageUnavailable(); }
  }
  return { upload, finalize, resolve, storage, uploadDir: storage.uploadDir };
}
module.exports = {
  createMediaService,
  normalizeImage,
  MAX_IMAGE_BYTES,
  defaultUploadDir,
};
