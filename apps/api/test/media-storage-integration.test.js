const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const express = require('express');
const request = require('supertest');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createFixture } = require('./admissions-fixture.cjs');
const { createMediaService } = require('../src/services/media-service');
const { createMediaCleanupService } = require('../src/services/media-cleanup-service');
const { createMediaRouter } = require('../src/routes/media');
const { errorHandler } = require('../src/http/middleware');
const { digest } = require('../src/storage/media-storage');

test('durable media: finalization, cross-instance reads, lifecycle and concurrent cleanup', { timeout: 60000 }, async t => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const db = require('../src/db/sequelize').createSequelize(config);
  const m = require('../src/db/models').initModels(db);
  const objects = new Map(); let putHook, corruptHead = false, failDelete = false, deleteCalls = 0, reads = 0;
  // Fake cloud adapter; all SQL/HTTP/image normalization use real implementations.
  const adapter = { provider: 'r2', bucket: 'nitewide-test-media',
    async put(asset, data) { assert.equal((await m.MediaAsset.findByPk(asset.id)).status, 'pending');
      objects.set(asset.id, { data, sizeBytes: data.length, sha256: digest(data), mimeType: 'image/webp', assetId: asset.id });
      await putHook?.(asset);
    },
    async head(asset) { const object = objects.get(asset.id); if (!object) throw new Error('Missing object');
      return { ...object, sha256: corruptHead ? 'invalid' : object.sha256 };
    },
    async remove(asset) { deleteCalls++; if (failDelete) throw new Error('Permission denied with sensitive provider details'); objects.delete(asset.id); },
    async accessUrl(asset) { reads++; return `https://r2.example.invalid/${asset.storageKey}?signed=${reads}`; },
  };
  const storage = { provider: 'r2', bucket: adapter.bucket, forAsset: () => adapter, close() {} };
  let fixture;
  try {
    fixture = await createFixture(m, config); const { ids } = fixture;
    const image = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#a066dd' } }).jpeg().withMetadata().toBuffer();
    const service = createMediaService({ models: m, storage });
    const app = express();
    app.use('/api', createMediaRouter({ models: m, storage, requireUser: (req, res, next) => {
      if (!req.headers['x-test-user']) return res.sendStatus(401); req.userId = req.headers['x-test-user']; next();
    } })); app.use(errorHandler);
    const age = id => m.MediaAsset.update({ cleanupAfter: new Date(Date.now()-60000) }, { where: { id } });
    const cleanup = () => createMediaCleanupService({ models: m, storage, enabled: true });
    let uploaded;
    await t.test('HTTP uploads normalize to WebP and finalize before returning stable asset URLs', async () => {
      const unauthorized = await request(app).post('/api/business/uploads/image').attach('image', image, 'flyer.jpg');
      assert.equal(unauthorized.status, 401);
      const response = await request(app).post('/api/business/uploads/image').set('x-test-user', ids.owner).attach('image', image, 'flyer.jpg');
      assert.equal(response.status, 201, JSON.stringify(response.body)); uploaded = response.body.data;
      assert.equal(uploaded.url, `/api/media/images/${uploaded.id}`);
      const row = await m.MediaAsset.findByPk(uploaded.id);
      assert.equal(row.status, 'ready'); assert.equal(row.storageProvider, 'r2'); assert.equal(row.managedUpload, true);
      assert.equal(row.storageKey, `events/${row.id}.webp`); assert.equal(row.storageBucket, adapter.bucket);
      assert.ok(!JSON.stringify(row).includes('?signed='));
      const metadata = await sharp(objects.get(row.id).data).metadata();
      assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined);
      const first = await request(app).get(uploaded.url); const second = await request(app).get(uploaded.url);
      assert.equal(first.status, 302); assert.equal(first.headers['cache-control'], 'no-store');
      assert.equal(first.headers['referrer-policy'], 'no-referrer'); assert.notEqual(first.headers.location, second.headers.location);
      // A second API instance needs only the DB and object adapter, not original disk files.
      const other = createMediaService({ models: m, uploadDir: '/nonexistent/nitewide-media-instance', storage });
      assert.match((await other.resolve(uploaded.id)).url, /^https:\/\/r2\.example\.invalid/);
      await m.Event.update({ imageAssetId: uploaded.id }, { where: { id: ids.event } });
      assert.equal((await m.Event.findByPk(ids.event)).imageUrl, uploaded.url);
    });
    await t.test('pending and failed verification objects cannot be read or attached', async () => {
      let pendingId;
      putHook = async asset => { pendingId = asset.id;
        assert.equal((await request(app).get(`/api/media/images/${asset.id}`)).status, 404);
        await assert.rejects(m.Event.update({ imageAssetId: asset.id }, { where: { id: ids.future } }), error => error.original?.constraint === 'event_media_ready');
      };
      corruptHead = true;
      try { await assert.rejects(service.upload(ids.owner, image), { code: 'MEDIA_VERIFICATION_FAILED' }); }
      finally { putHook = null; corruptHead = false; }
      assert.equal((await m.MediaAsset.findByPk(pendingId)).status, 'pending');
      await assert.rejects(service.finalize(ids.outsider, pendingId), { status: 404 });
      await service.finalize(ids.owner, pendingId); assert.equal((await m.MediaAsset.findByPk(pendingId)).status, 'ready');
    });
    await t.test('upload failure stays tracked and account suspension is rechecked after storage writes', async () => {
      let failedId;
      putHook = async asset => { failedId = asset.id; throw new Error('Provider failure with credentials'); };
      try { await assert.rejects(service.upload(ids.owner, image), error => error.code === 'MEDIA_STORAGE_UNAVAILABLE' && !error.message.includes('credentials')); }
      finally { putHook = null; }
      assert.equal((await m.MediaAsset.findByPk(failedId)).lastStorageError, 'UPLOAD_FAILED');
      putHook = async () => m.User.update({ lifecycleState: 'suspended' }, { where: { id: ids.owner } });
      try { await assert.rejects(service.upload(ids.owner, image), { code: 'FORBIDDEN' }); }
      finally { putHook = null; await m.User.update({ lifecycleState: 'active' }, { where: { id: ids.owner } }); }
    });
    await t.test('cleanup protects attached, shared, archived, young and unmanaged legacy assets', async () => {
      await m.Event.update({ imageAssetId: uploaded.id, lifecycleState: 'archived' }, { where: { id: ids.future } });
      await age(uploaded.id);
      const young = await service.upload(ids.owner, image);
      const legacyId = randomUUID();
      await m.MediaAsset.create({ id: legacyId, uploadedByUserId: ids.owner, storageKey: `${legacyId}.webp`, mimeType: 'image/webp', sizeBytes: 1, width: 128, height: 128, cleanupAfter: new Date(0) });
      const orphan = await service.upload(ids.owner, image); await age(orphan.id);
      const before = deleteCalls; assert.equal(await cleanup().drain(), 1); assert.equal(deleteCalls-before, 1);
      assert.equal(await m.MediaAsset.findByPk(orphan.id), null); assert.ok(!objects.has(orphan.id));
      for (const id of [uploaded.id, young.id, legacyId]) assert.ok(await m.MediaAsset.findByPk(id));
      await m.Event.update({ imageAssetId: null }, { where: { id: ids.event } });
      assert.ok((await m.MediaAsset.findByPk(uploaded.id)).cleanupAfter > new Date());
      await age(uploaded.id); assert.equal(await cleanup().drain(), 0, 'another archived event still references the same flyer');
      await m.Event.unscoped().update({ imageAssetId: null }, { where: { id: ids.future } });
      assert.equal(await cleanup().drain(), 0, 'detach starts a new grace period');
      await age(uploaded.id); assert.equal(await cleanup().drain(), 1);
    });
    await t.test('failed deletes retain tombstones, reject reattachment and retry without duplicating work', async () => {
      const orphan = await service.upload(ids.owner, image); await age(orphan.id); failDelete = true;
      try { assert.equal(await cleanup().drain(), 0); } finally { failDelete = false; }
      const row = await m.MediaAsset.findByPk(orphan.id);
      assert.equal(row.status, 'deleting'); assert.equal(row.lastStorageError, 'CLEANUP_FAILED');
      assert.equal(await service.resolve(orphan.id), null);
      await assert.rejects(m.Event.update({ imageAssetId: orphan.id }, { where: { id: ids.draft } }), error => error.original?.constraint === 'event_media_ready');
      await age(orphan.id);
      const workers = [cleanup(), cleanup()]; const results = await Promise.all(workers.map(worker => worker.drain()));
      assert.equal(results.reduce((sum, count) => sum+count, 0), 1);
      assert.equal(await m.MediaAsset.findByPk(orphan.id), null);
    });
    await t.test('concurrent attachment wins its row lock; cleanup cannot delete its committed reference', async () => {
      const item = await service.upload(ids.owner, image); await age(item.id);
      const tx = await db.transaction();
      try {
        await m.Event.update({ imageAssetId: item.id }, { where: { id: ids.draft }, transaction: tx });
        assert.equal(await cleanup().drain(), 0, 'SKIP LOCKED never deletes an in-flight attachment');
        await tx.commit();
      } catch (error) { await tx.rollback(); throw error; }
      await age(item.id); assert.equal(await cleanup().drain(), 0);
      assert.ok(objects.has(item.id));
    });
    await t.test('stopped and disabled workers never issue cloud operations', async () => {
      const disabled = createMediaCleanupService({ models: m, storage }); assert.equal(await disabled.drain(), 0);
      const stopped = cleanup(); await stopped.stop(); assert.equal(await stopped.drain(), 0);
    });
  } finally { await db.close(); }
});
