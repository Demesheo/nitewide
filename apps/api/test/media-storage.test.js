const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createR2Storage, createLocalStorage, createMediaStorage, digest } = require('../src/storage/media-storage');
const { getConfig } = require('../src/config');
const { offlineEnvironment } = require('../scripts/test-database.cjs');
const credentials = { MEDIA_STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'nitewide-dev-media',
  R2_ACCESS_KEY_ID: 'b'.repeat(32), R2_SECRET_ACCESS_KEY: 'c'.repeat(64), R2_READ_URL_TTL_SECONDS: 900 };
const asset = () => { const id = randomUUID(); return { id, storageProvider: 'r2', storageBucket: credentials.R2_BUCKET, storageKey: `events/${id}.webp` }; };

test('R2 writes include integrity metadata; private read URLs are generated on demand', async () => {
  const commands = []; const signatures = [];
  const item = asset(), data = Buffer.from('normalized image fixture');
  const client = { send: async (command, options) => {
    commands.push(command); assert.ok(options.abortSignal);
    return { ContentLength: data.length, ContentType: 'image/webp', Metadata: { 'asset-id': item.id, sha256: digest(data) } };
  } };
  const r2 = createR2Storage({ config: credentials, client, sign: async (_client, command, options) => {
    signatures.push({ command, options }); return `https://example.invalid/object?signature=${signatures.length}`;
  } });
  await r2.put(item, data);
  assert.equal(commands[0].constructor.name, 'PutObjectCommand');
  assert.equal(commands[0].input.Bucket, credentials.R2_BUCKET);
  assert.equal(commands[0].input.Key, item.storageKey);
  assert.equal(commands[0].input.ContentType, 'image/webp');
  assert.equal(commands[0].input.Metadata.sha256, digest(data));
  assert.ok(commands[0].input.ContentMD5);
  assert.deepEqual(await r2.head(item), { sizeBytes: data.length, mimeType: 'image/webp', sha256: digest(data), assetId: item.id });
  assert.notEqual(await r2.accessUrl(item), await r2.accessUrl(item));
  assert.equal(signatures[0].options.expiresIn, 900);
  assert.equal(signatures[0].command.constructor.name, 'GetObjectCommand');
  await r2.remove(item); assert.equal(commands.at(-1).constructor.name, 'DeleteObjectCommand');
  assert.equal(item.url, undefined, 'signed URL never mutates the persisted asset');
});

test('storage refuses traversal, malformed IDs and unexpected bucket keys before I/O', async () => {
  let calls = 0;
  const r2 = createR2Storage({ config: credentials, client: { send: async () => { calls++; } } });
  const item = asset();
  await assert.rejects(r2.put({ ...item, storageKey: '../secret.webp' }, Buffer.from('x')), /Invalid managed/);
  await assert.rejects(r2.remove({ ...item, id: '-'.repeat(36) }), /Invalid managed/);
  await assert.rejects(r2.head({ ...item, storageBucket: 'invalid/bucket' }), /Invalid media bucket/);
  assert.equal(calls, 0);
});

test('missing object deletion is idempotent; access denied remains a retryable error', async () => {
  let failure = { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } };
  const r2 = createR2Storage({ config: credentials, client: { send: async () => { throw failure; } } });
  await r2.remove(asset());
  failure = { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } };
  await assert.rejects(r2.remove(asset()), error => error === failure);
});

test('local storage is immutable and legacy assets still use local storage after switching to R2', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nitewide-media-unit-'));
  const id = randomUUID(); const item = { id, storageProvider: 'local', storageKey: `${id}.webp` };
  const data = Buffer.from('local fixture');
  try {
    const storage = createLocalStorage({ uploadDir: directory });
    await storage.put(item, data);
    await assert.rejects(storage.put(item, data), { code: 'EEXIST' });
    assert.equal((await storage.head(item)).sha256, digest(data));
    assert.equal(createMediaStorage({ config: credentials, uploadDir: directory }).forAsset(item).provider, 'local');
    await storage.remove(item); await storage.remove(item);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('R2 configuration fails safely and standard test environments cannot use live cloud credentials', () => {
  const environment = { NODE_ENV: 'test', DATABASE_SSL: 'false', ...credentials };
  assert.equal(getConfig(environment).R2_BUCKET, credentials.R2_BUCKET);
  for (const key of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    assert.throws(() => getConfig({ ...environment, [key]: '' }), new RegExp(`requires ${key}`));
  }
  assert.throws(() => getConfig({ ...environment, R2_ENDPOINT: 'https://attacker.invalid' }), /HTTPS Cloudflare R2 endpoint/);
  assert.throws(() => getConfig({ NODE_ENV: 'test', MEDIA_CLEANUP_ENABLED: 'true' }), /cleanup requires R2/);
  const safe = getConfig(offlineEnvironment({ ...environment, MEDIA_CLEANUP_ENABLED: 'true' }));
  assert.equal(safe.MEDIA_STORAGE_DRIVER, 'local'); assert.equal(safe.R2_ACCESS_KEY_ID, undefined);
  assert.equal(safe.MEDIA_CLEANUP_ENABLED, 'false');
});

test('actual presigning needs no cloud request and stays on the exact account origin allowed by CSP', async () => {
  const r2 = createR2Storage({ config: credentials }); const item = asset();
  try {
    const url = new URL(await r2.accessUrl(item));
    assert.equal(url.origin, `https://${credentials.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    assert.equal(url.pathname, `/${credentials.R2_BUCKET}/${item.storageKey}`);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  } finally { r2.close(); }
});
