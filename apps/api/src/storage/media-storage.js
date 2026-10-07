const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { S3Client, PutObjectCommand, HeadBucketCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const defaultUploadDir = path.resolve(__dirname, '../../uploads/events');
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const missingObject = error => error?.code === 'ENOENT' || ['NotFound', 'NoSuchKey'].includes(error?.name) || error?.$metadata?.httpStatusCode === 404;
function assertKey(asset) {
  const expected = asset.storageProvider === 'r2' ? `events/${asset.id}.webp` : `${asset.id}.webp`;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(asset.id) || asset.storageKey !== expected) throw new Error('Invalid managed media key');
  if (asset.storageProvider === 'r2' && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(asset.storageBucket || '')) throw new Error('Invalid media bucket');
}
function createLocalStorage({ uploadDir = defaultUploadDir } = {}) {
  return {
    provider: 'local', bucket: null, uploadDir,
    async put(asset, buffer) { assertKey(asset); await fs.mkdir(uploadDir, { recursive: true }); await fs.writeFile(path.join(uploadDir, asset.storageKey), buffer, { flag: 'wx' }); },
    async head(asset) { assertKey(asset); const buffer = await fs.readFile(path.join(uploadDir, asset.storageKey)); return { sizeBytes: buffer.length, sha256: digest(buffer), mimeType: 'image/webp' }; },
    async remove(asset) { assertKey(asset); try { await fs.unlink(path.join(uploadDir, asset.storageKey)); } catch (error) { if (!missingObject(error)) throw error; } },
    filePath(asset) { assertKey(asset); return path.join(uploadDir, asset.storageKey); },
  };
}
function createR2Storage({ config, client, sign = getSignedUrl }) {
  const ownsClient = !client;
  client ||= new S3Client({ region: 'auto', forcePathStyle: true, endpoint: config.R2_ENDPOINT || `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY },
    maxAttempts: 3, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  const input = asset => { assertKey(asset); return { Bucket: asset.storageBucket, Key: asset.storageKey }; };
  const send = command => client.send(command, { abortSignal: AbortSignal.timeout(30000) });
  return {
    provider: 'r2', bucket: config.R2_BUCKET,
    // One bounded, read-only request at release startup; never create a probe object.
    async checkAccess() {
      await client.send(new HeadBucketCommand({ Bucket: config.R2_BUCKET }), { abortSignal: AbortSignal.timeout(10000) });
    },
    async put(asset, buffer) {
      await send(new PutObjectCommand({ ...input(asset), Body: buffer, ContentType: 'image/webp',
        ContentMD5: createHash('md5').update(buffer).digest('base64'),
        Metadata: { 'asset-id': asset.id, sha256: digest(buffer) } }));
    },
    async head(asset) { const result = await send(new HeadObjectCommand(input(asset))); return { sizeBytes: result.ContentLength, mimeType: result.ContentType, sha256: result.Metadata?.sha256, assetId: result.Metadata?.['asset-id'] }; },
    async accessUrl(asset) { return sign(client, new GetObjectCommand(input(asset)), { expiresIn: config.R2_READ_URL_TTL_SECONDS || 900 }); },
    async remove(asset) { try { await send(new DeleteObjectCommand(input(asset))); } catch (error) { if (!missingObject(error)) throw error; } },
    close() { if (ownsClient) client.destroy(); },
  };
}
function createMediaStorage({ config = {}, uploadDir, r2Client, sign } = {}) {
  const local = createLocalStorage({ uploadDir: uploadDir || config.MEDIA_UPLOAD_DIR });
  let r2;
  const forAsset = asset => {
    if (asset.storageProvider === 'r2') {
      if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY) throw new Error('R2 credentials are not configured');
      r2 ||= createR2Storage({ config, client: r2Client, sign }); return r2;
    }
    if (!asset.storageProvider || asset.storageProvider === 'local') return local;
    throw new Error('Unsupported media storage provider');
  };
  return { provider: config.MEDIA_STORAGE_DRIVER || 'local', bucket: config.MEDIA_STORAGE_DRIVER === 'r2' ? config.R2_BUCKET : null,
    forAsset, uploadDir: local.uploadDir, close() { r2?.close(); } };
}
module.exports = { createMediaStorage, createLocalStorage, createR2Storage, defaultUploadDir, digest, assertKey, missingObject };
