// Local demo-data import only: no API route, no credentials sent to Posh, no reset.
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Op } = require('sequelize');
const { firstNonOverlapping } = require('./seed-venue-policy');
const { overlaps } = require('./seed-booking-policy');
const { normalizeImage, MAX_IMAGE_BYTES, defaultUploadDir } = require('../services/media-service');

const DEMO_NOTICE = 'Nitewide demo listing: prices, packages, inventory and guestlist allocations are sample data, not offers from the source organizer. No real booking is made.';
function stableId(value) {
  const h = createHash('sha256').update(`nitewide:posh-demo:${value}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function assertLocalDemoDatabase(config) {
  if (config.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname)) {
    throw new Error('Posh demo imports are restricted to a non-production, local database.');
  }
}
function validateSnapshot(snapshot) {
  if (snapshot.city !== 'Orlando' || snapshot.region !== 'FL' || snapshot.timezone !== 'America/New_York') throw new Error('Only verified Orlando fixtures are supported');
  const start = Date.parse(snapshot.windowStart), end = Date.parse(snapshot.windowEndExclusive);
  if (!Number.isFinite(start) || end - start !== 30 * 86400000) throw new Error('Expected a fixed 30-day snapshot window');
  const seen = new Set();
  for (const event of snapshot.events) {
    const from = Date.parse(event.startsAt), to = Date.parse(event.endsAt);
    if (!snapshot.venues[event.venueSlug] || !Number.isFinite(from) || !Number.isFinite(to) || from < start || from >= end || to <= from) throw new Error(`Invalid venue or dates: ${event.title}`);
    if (!/T\d{2}:\d{2}:\d{2}-04:00$/.test(event.startsAt) || !/T\d{2}:\d{2}:\d{2}-04:00$/.test(event.endsAt)) throw new Error('This September/October snapshot requires explicit EDT offsets');
    if (!/^https:\/\/posh\.vip\/e\/[a-z0-9-]+$/.test(event.sourceUrl) || !/^https:\/\/images\.posh\.vip\/originals\/[a-f0-9]{24}$/.test(event.imageUrl)) throw new Error('Unexpected source URL');
    if (!event.title || event.title.length > 180 || !event.description || !['paraphrase', 'factual-fallback'].includes(event.descriptionKind)) throw new Error('Missing reviewed event content');
    if (seen.has(event.sourceUrl)) throw new Error('Duplicate source occurrence');
    seen.add(event.sourceUrl);
  }
  return snapshot.events;
}
function upcomingEvents(snapshot, now = new Date()) {
  validateSnapshot(snapshot);
  // Intersect fixed verified occurrences with the actual upcoming 30 days. No re-dating.
  return snapshot.events.filter(event => Date.parse(event.startsAt) >= now.getTime() && Date.parse(event.startsAt) < now.getTime() + 30 * 86400000);
}
async function readLimitedImage(url, fetchImpl = fetch) {
  if (!/^https:\/\/images\.posh\.vip\/originals\/[a-f0-9]{24}$/.test(url)) throw new Error('Unapproved image host/path');
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  const contentType = response.headers.get('content-type');
  if (!response.ok || (contentType && !/^image\/(jpeg|png|webp)(;|$)/i.test(contentType))) throw new Error(`Image unavailable: ${url}`);
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MB');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MB');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  // Some original Posh assets omit Content-Type. Never trust that omission:
  // decode/validate the bounded bytes before allowing them into the cache path.
  if (!contentType) await normalizeImage(buffer);
  return buffer;
}
async function prepareImage(url, uploadDir, fetchImpl) {
  // Cache is source-addressed; reruns and fresh seeds reuse it without hotlinking.
  const id = stableId(`image:${url}`), storageKey = `${id}.webp`;
  const filename = path.join(uploadDir, storageKey);
  let buffer;
  try { buffer = await fs.readFile(filename); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { data, info } = await normalizeImage(buffer || await readLimitedImage(url, fetchImpl));
  await fs.mkdir(uploadDir, { recursive: true });
  if (!buffer) {
    try { await fs.writeFile(filename, data, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  // Use original cached bytes for metadata; normalization above validates them.
  return { id, storageKey, mimeType: 'image/webp', sizeBytes: (buffer || data).length, width: info.width, height: info.height };
}
function demoOfferings(eventId, startsAt, now) {
  return [
    { name: 'General Admission', kind: 'ticket', priceCents: 1000, quantityTotal: 350, entriesPerUnit: 1, maxPerOrder: 8 },
    { name: '2 Regular Bottles', kind: 'package', priceCents: 30000, quantityTotal: 24, entriesPerUnit: 4, maxPerOrder: 2 },
    { name: '2 Premium Bottles', kind: 'package', priceCents: 40000, quantityTotal: 18, entriesPerUnit: 4, maxPerOrder: 2 },
    { name: '2 Clase Azul / 1942 Bottles', kind: 'package', priceCents: 100000, quantityTotal: 10, entriesPerUnit: 4, maxPerOrder: 2 },
  ].map((offering, index) => ({ ...offering, id: stableId(`${eventId}:offering:${index}`), eventId, description: 'Demonstration inventory only. Not the source event ticket or package offer.', sortOrder: index + 1, salesStartAt: now, salesEndAt: startsAt }));
}

async function importPoshSnapshot({ sequelize, models: m, config, snapshot, apply = false, now = new Date(), fetchImpl = fetch }) {
  assertLocalDemoDatabase(config);
  let events = upcomingEvents(snapshot, now);
  const report = { snapshot: snapshot.snapshotId, mode: apply ? 'apply' : 'dry-run', windowStart: snapshot.windowStart, windowEndExclusive: snapshot.windowEndExclusive,
    eligible: events.length, created: 0, skipped: 0, venues: {}, renamed: [], unmatchedVenues: snapshot.unmatchedVenues };
  if (!events.length) return report;
  // Resolve all referenced existing organizations and owners before downloading anything.
  const contexts = new Map();
  for (const slug of new Set(events.map(event => event.venueSlug))) {
    const expected = snapshot.venues[slug];
    const organizationSlug = expected.organizationSlug || slug;
    let organization = await m.Organization.findOne({ where: { slug: organizationSlug } });
    if (!organization && !apply && expected.provision) organization = { id: stableId(`organization:${slug}`), name: expected.name, slug };
    if (!organization || (!expected.organizationSlug && ![expected.name, expected.previousName].filter(Boolean).includes(organization.name))) throw new Error(`Expected demo venue ${expected.name} (${slug}); nothing imported`);
    const owner = !apply && expected.provision && !organization.reload ? { userId: stableId(`user:${slug}.owner1@nitewide.test`) }
      : await m.OrganizationOwner.findOne({ where: { organizationId: organization.id, role: 'owner' }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
    if (!owner) throw new Error(`Missing owner for ${expected.name}`);
    contexts.set(slug, { organization, owner, expected });
    report.venues[expected.name] = events.filter(event => event.venueSlug === slug).length;
  }
  if (snapshot.skipVenueOverlaps) {
    const existing = [];
    for (const [slug, { expected }] of contexts) {
      // Physical location, not organization: Proper and Room 22 can run simultaneously.
      const locations = await m.Location.findAll({ where: { city: 'Orlando', addressLine1: expected.addressLine1 } });
      const rows = await m.Event.findAll({ where: { locationId: locations.map(l => l.id), status: { [Op.ne]: 'cancelled' } } });
      existing.push(...rows.map(e => ({ ...e.toJSON(), venueSlug: slug })));
    }
    // Existing source IDs are handled as reruns below, not reported as overlaps.
    const candidates = events.filter(e => !existing.some(x => x.id === stableId(e.sourceUrl)));
    const selection = firstNonOverlapping(candidates, existing);
    const allowed = new Set(selection.kept.map(e => e.sourceUrl));
    events = events.filter(e => allowed.has(e.sourceUrl) || existing.some(x => x.id === stableId(e.sourceUrl)));
    report.overlapSkipped = selection.skipped.map(({ event, conflict }) => ({ sourceUrl: event.sourceUrl, conflictsWith: conflict.sourceUrl || conflict.id }));
  }
  const pending = [];
  for (const event of events) {
    const id = stableId(event.sourceUrl), existing = await m.Event.findByPk(id);
    if (existing) {
      if (existing.organizationId !== contexts.get(event.venueSlug).organization.id) throw new Error('Source ID conflicts with a different organization');
      report.skipped++;
    } else pending.push({ ...event, id });
  }
  if (!apply) { report.wouldCreate = pending.length; return report; }
  const images = new Map(), uploadDir = config.MEDIA_UPLOAD_DIR || defaultUploadDir;
  for (const event of pending) {
    if (!images.has(event.imageUrl)) images.set(event.imageUrl, await prepareImage(event.imageUrl, uploadDir, fetchImpl));
  }
  // Atomic DB insert + advisory lock makes concurrent runs and retries safe.
  await sequelize.transaction(async transaction => {
    await sequelize.query("SELECT pg_advisory_xact_lock(7210921)", { transaction });
    for (const [slug, { organization, owner, expected }] of contexts) {
      await organization.reload({ transaction, lock: transaction.LOCK.UPDATE });
      if (expected.previousName && organization.name === expected.previousName) {
        await organization.update({ name: expected.name }, { transaction });
        await m.AuditLog.create({ actorUserId: owner.userId, organizationId: organization.id, entityType: 'Organization', entityId: organization.id, action: 'organization.demo_renamed', before: { name: expected.previousName }, after: { name: expected.name, reason: 'User confirmed Tier is now OHM; slug and IDs preserved' } }, { transaction });
        report.renamed.push(`${expected.previousName} → ${expected.name}`);
      }
    }
    for (const event of pending) {
      if (await m.Event.findByPk(event.id, { transaction })) { report.skipped++; continue; }
      const { organization, owner, expected } = contexts.get(event.venueSlug);
      const locationId = stableId(`location:${event.venueSlug}:${expected.addressLine1}`);
      if (snapshot.skipVenueOverlaps) {
        const locations = await m.Location.findAll({ where: { city: 'Orlando', addressLine1: expected.addressLine1 }, transaction });
        const conflicts = await m.Event.count({ where: { locationId: locations.map(l => l.id), status: { [Op.ne]: 'cancelled' }, startsAt: { [Op.lt]: event.endsAt }, endsAt: { [Op.gt]: event.startsAt } }, transaction });
        if (conflicts) { report.skipped++; continue; }
      }
      const [location] = await m.Location.findOrCreate({ where: { id: locationId }, defaults: { name: expected.name, addressLine1: expected.addressLine1, city: snapshot.city, region: snapshot.region, postalCode: '32801', countryCode: 'US', timezone: snapshot.timezone, privacy: 'public' }, transaction });
      const image = images.get(event.imageUrl);
      await m.MediaAsset.findOrCreate({ where: { id: image.id }, defaults: { ...image, uploadedByUserId: owner.userId }, transaction });
      await m.Event.create({ id: event.id, organizationId: organization.id, creatorUserId: owner.userId, locationId: location.id, imageAssetId: image.id,
        title: event.title, slug: `posh-${new URL(event.sourceUrl).pathname.split('/').pop()}`, summary: `${event.description.slice(0, 420)} [Demo listing]`,
        description: `${event.description}\n\n${DEMO_NOTICE}\nSource: ${event.sourceUrl}\nVerified: ${snapshot.verifiedOn} (America/New_York).`,
        startsAt: event.startsAt, endsAt: event.endsAt, category: 'nightlife', status: 'published', isDiscoverable: true, capacity: 500, guestlistCapacity: 50 }, { transaction });
      await m.Offering.bulkCreate(demoOfferings(event.id, event.startsAt, now), { transaction, validate: true });
      const affiliates = expected.availablePromotersOnly ? [] : (await m.OrgAffiliate.findAll({ where: { organizationId: organization.id, status: 'active' }, transaction }))
        .filter((affiliate) => !affiliate.code.endsWith('-STAFF'));
      await m.EventAffiliate.bulkCreate(affiliates.map(affiliate => ({ id: stableId(`${event.id}:${affiliate.id}`), eventId: event.id, userId: affiliate.userId, orgAffiliateId: affiliate.id,
        code: `PD-${stableId(`${event.id}:${affiliate.id}`)}`, commissionBps: null, guestlistAllocation: affiliate.defaultCommissionBps > 0 ? 20 : affiliate.defaultGuestlistAllocation })), { transaction, validate: true });
      if (expected.availablePromotersOnly) {
        const users = await m.User.findAll({ where: { email: { [Op.like]: '%promoter%@nitewide.test' }, isActive: true }, order: [['email', 'ASC']], transaction });
        const assigned = await m.EventAffiliate.findAll({ where: { status: 'active' }, include: [{ model: m.Event, as: 'event', where: { status: { [Op.ne]: 'cancelled' } } }], transaction });
        const eligible = users.filter(user => !assigned.some(a => a.userId === user.id && overlaps(a.event, event)));
        while (eligible.length < 2) {
          const number = users.length + 1;
          const email = `orlando.expansion.promoter${number}@nitewide.test`;
          const { createPasswordRecord } = require('../services/auth-service');
          const [user, created] = await m.User.findOrCreate({ where: { email }, defaults: { id: stableId(`user:${email}`), displayName: `${['Aria', 'Dante', 'Camden', 'Jules', 'Sienna', 'Rafael'][number % 6]} ${['Reyes', 'Blake', 'Vega'][Math.floor(number / 6) % 3]}` }, transaction });
          if (!created) throw new Error('Demo promoter identity collision; import rolled back');
          await m.UserCredential.create({ userId: user.id, ...(await createPasswordRecord(require('./seed').demoPassword)) }, { transaction });
          users.push(user); eligible.push(user);
          report.promotersCreated = (report.promotersCreated || 0) + 1;
        }
        await m.EventAffiliate.bulkCreate(eligible.slice(0, 2).map((user, index) => ({ id: stableId(`${event.id}:promoter:${user.id}`), eventId: event.id, userId: user.id,
          code: `PD-${stableId(`${event.id}:promoter:${user.id}`)}`, commissionBps: 800 + index * 200, guestlistAllocation: 20 })), { transaction, validate: true });
      }
      await m.AuditLog.create({ actorUserId: owner.userId, organizationId: organization.id, entityType: 'Event', entityId: event.id, action: 'event.posh_demo_imported', after: {
        snapshotId: snapshot.snapshotId, verifiedOn: snapshot.verifiedOn, sourceUrl: event.sourceUrl, imageSourceUrl: event.imageUrl, sourceVenue: expected.sourceName,
        descriptionKind: event.descriptionKind, sourceSalesStatus: event.sourceSalesStatus, endTimeEvidence: event.endTimeEvidence || 'Explicit recurring date/time chips on the source page', addressNote: expected.addressNote || null, demoCommerce: true,
      } }, { transaction });
      report.created++;
    }
  });
  return report;
}
module.exports = { importPoshSnapshot, validateSnapshot, upcomingEvents, stableId, assertLocalDemoDatabase, readLimitedImage, demoOfferings };
