const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const snapshot = require('../src/db/fixtures/posh-orlando-2026-09-21');
const { importPoshSnapshot, stableId, assertLocalDemoDatabase } = require('../src/db/posh-importer');

test('Posh import is additive, atomic, repeatable, concurrent-safe and preserves edits', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { Op } = require('sequelize');
  const config = getConfig();
  assertLocalDemoDatabase(config);
  const sequelize = createSequelize(config), m = initModels(sequelize);
  const run = randomUUID(), userId = randomUUID(), affiliateUserId = randomUUID(), orgId = randomUUID();
  const slug = `qa-posh-${run}`, imageUrl = `https://images.posh.vip/originals/${run.replaceAll('-', '').slice(0, 24)}`;
  const fixture = { ...structuredClone(snapshot), venues: { [slug]: { name: 'OHM fixture', previousName: 'Tier fixture', sourceName: 'OHM fixture', addressLine1: '20 E Central Blvd' } },
    events: snapshot.events.slice(0, 2).map((event, index) => ({ ...event, venueSlug: slug, sourceUrl: `https://posh.vip/e/qa-${run}-${index}`, imageUrl })), unmatchedVenues: [] };
  const eventIds = fixture.events.map(e => stableId(e.sourceUrl));
  const rollbackEvent = { ...fixture.events[0], sourceUrl: `https://posh.vip/e/qa-${run}-rollback` };
  eventIds.push(stableId(rollbackEvent.sourceUrl));
  const uploadDir = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'nitewide-posh-test-'));
  const imageId = stableId(`image:${imageUrl}`);
  let downloads = 0;
  const png = await sharp({ create: { width: 128, height: 192, channels: 3, background: '#1C1859' } }).png().toBuffer();
  const args = { sequelize, models: m, config: { ...config, MEDIA_UPLOAD_DIR: uploadDir }, snapshot: fixture, now: new Date('2026-09-21T12:00:00Z'),
    fetchImpl: async () => { downloads++; return new Response(png, { headers: { 'content-type': 'image/png' } }); } };
  try {
    await m.User.bulkCreate([userId, affiliateUserId].map(id => ({ id, displayName: 'Posh import test', email: `${id}@integration.nitewide.test` })));
    await m.Organization.create({ id: orgId, name: 'Tier fixture', slug });
    await m.OrganizationOwner.create({ organizationId: orgId, userId, role: 'owner' });
    await m.OrgAffiliate.create({ organizationId: orgId, userId: affiliateUserId, code: `QA-${run}`, defaultCommissionBps: 800, defaultGuestlistAllocation: 10 });
    const initialEventCount = await m.Event.count({ where: { organizationId: orgId } });
    const initialOrders = await m.Order.count({ where: { eventId: eventIds } });
    const dry = await importPoshSnapshot(args);
    assert.equal(dry.wouldCreate, 2);
    assert.equal(downloads, 0);
    assert.equal(await m.Event.count({ where: { organizationId: orgId } }), initialEventCount);
    assert.equal((await m.Organization.findByPk(orgId)).name, 'Tier fixture');

    const results = await Promise.all([importPoshSnapshot({ ...args, apply: true }), importPoshSnapshot({ ...args, apply: true })]);
    assert.equal(results.reduce((n, r) => n + r.created, 0), 2);
    assert.equal((await m.Organization.findByPk(orgId)).name, 'OHM fixture');
    assert.equal(await m.Event.count({ where: { organizationId: orgId } }), 2);
    assert.equal(await m.Order.count({ where: { eventId: eventIds } }), initialOrders);
    assert.equal(await m.Offering.count({ where: { eventId: eventIds } }), 8);
    assert.equal(await m.EventAffiliate.count({ where: { eventId: eventIds, guestlistAllocation: 20 } }), 2);
    assert.equal(await m.AuditLog.count({ where: { organizationId: orgId, action: 'event.posh_demo_imported' } }), 2);
    assert.equal(await m.MediaAsset.count({ where: { id: imageId } }), 1);
    const event = await m.Event.findByPk(eventIds[0]);
    assert.match(event.imageUrl, /^\/api\/media\/images\//);
    assert.equal(event.guestlistCapacity, 50);
    const location = await m.Location.findByPk(event.locationId);
    assert.equal(location.city, 'Orlando');
    assert.equal(location.timezone, 'America/New_York');
    await event.update({ title: 'Manually edited title' });
    const offer = await m.Offering.findOne({ where: { eventId: event.id }, order: [['sortOrder', 'ASC']] });
    await offer.update({ quantitySold: 2 });
    const oldDownloads = downloads;
    const rerun = await importPoshSnapshot({ ...args, apply: true });
    assert.equal(rerun.created, 0);
    assert.equal(rerun.skipped, 2);
    assert.equal(downloads, oldDownloads);
    assert.equal((await event.reload()).title, 'Manually edited title');
    assert.equal((await offer.reload()).quantitySold, 2);
    const failing = { ...args, apply: true, snapshot: { ...fixture, events: [rollbackEvent] }, models: { ...m, Offering: { bulkCreate: async () => { throw new Error('injected inventory failure'); } } } };
    await assert.rejects(importPoshSnapshot(failing), /injected inventory failure/);
    assert.equal(await m.Event.findByPk(stableId(rollbackEvent.sourceUrl)), null);
    assert.equal(await m.Event.count({ where: { organizationId: orgId } }), 2);
  } finally {
    // Only isolated test-owned IDs and a mkdtemp directory are removed.
    await m.AuditLog.destroy({ where: { organizationId: orgId } });
    await m.EventAffiliate.destroy({ where: { eventId: { [Op.in]: eventIds } } });
    await m.Offering.destroy({ where: { eventId: { [Op.in]: eventIds } } });
    await m.Event.destroy({ where: { id: { [Op.in]: eventIds } } });
    await m.MediaAsset.destroy({ where: { id: imageId } });
    await m.Location.destroy({ where: { id: stableId(`location:${slug}:20 E Central Blvd`) } });
    await m.OrgAffiliate.destroy({ where: { organizationId: orgId } });
    await m.OrganizationOwner.destroy({ where: { organizationId: orgId } });
    await m.Organization.destroy({ where: { id: orgId } });
    await m.User.destroy({ where: { id: { [Op.in]: [userId, affiliateUserId] } } });
    await sequelize.close();
    await fs.rm(uploadDir, { recursive: true, force: true });
  }
});
