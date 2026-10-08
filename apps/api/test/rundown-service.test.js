const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRundownService, rundownEvent, decodeRundownCursor, decodePreviewRundownCursor } = require('../src/services/rundown-service');
const schemas = require('../src/http/rundown-schemas');
const { resolveAffiliate } = require('../src/services/affiliate-service');

test('rundown projection is closed to future operational fields and keeps public offering price and sale state', () => {
  const now = new Date(), future = new Date(+now + 3600000), secret = 'must remain private';
  const hidden = { id: 'hidden', isActive: true, visibility: 'password', quantityTotal: 1, quantitySold: 1, inventoryMode: 'finite', accessCodeHash: secret };
  const publicOffer = { id: 'public', name: 'Admission', priceCents: 2000, isActive: true, visibility: 'public', inventoryMode: 'finite',
    quantityTotal: 5, quantitySold: 0, releaseAfterOfferingId: 'hidden', quantityReserved: 1, accessCodeHash: secret, paymentCredentials: secret };
  const source = { id: randomUUID(), title: 'Public', startsAt: now, endsAt: future, feeMode: 'absorbed', paymentAccountId: secret,
    commissionMinimumSubtotalCents: 1700, creatorUserId: secret, lifecycleState: 'active', futureOperationalField: secret,
    organization: { id: randomUUID(), name: 'Business', planTier: 'premium', stripeAccountId: secret },
    location: { id: randomUUID(), name: 'Room', city: 'Austin', privacy: 'attendees_only', addressLine1: secret, latitude: 30,
      longitude: -97, geo: secret, geocodeAddressHash: secret }, offerings: [hidden, publicOffer] };
  const projected = rundownEvent({ ...source, toJSON: () => source }, now);
  assert.equal(projected.offerings.length, 1); assert.equal(projected.offerings[0].priceCents, 2000);
  assert.equal(projected.offerings[0].effectiveFeeMode, 'absorbed'); assert.equal(projected.offerings[0].saleState, 'on_sale', 'hidden predecessor still informs the public ladder');
  assert.equal(projected.isPremiumHost, true); assert.equal(JSON.stringify(projected).includes(secret), false);
  assert.equal('futureOperationalField' in projected, false); assert.equal('quantityReserved' in projected.offerings[0], false);
  assert.equal('releaseAfterOfferingId' in projected.offerings[0], false);
  source.location.privacy = 'private'; assert.equal('addressLine1' in rundownEvent(source).location, false);
  source.location.privacy = 'public'; assert.equal(rundownEvent(source).location.addressLine1, secret);
  assert.equal('geocodeAddressHash' in rundownEvent(source).location, false);
});

test('rundown cursors are strict and bound to one profile, and APIs reject custom handles/editors or geography filters', () => {
  const id = randomUUID(), cursor = { version: 1, rundownId: id, startsAt: new Date().toISOString(), id: randomUUID() };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  assert.deepEqual(decodeRundownCursor(encode(cursor), id), cursor);
  for (const candidate of ['garbage', encode({ ...cursor, rundownId: randomUUID() }), encode({ ...cursor, extra: true }), encode({ ...cursor, version: 2 }), encode({ ...cursor, startsAt: 'bad' })]) {
    assert.throws(() => decodeRundownCursor(candidate, id), { code: 'INVALID_RUNDOWN_CURSOR', status: 422 });
  }
  assert.deepEqual(schemas.pageQuery.parse({}), { pageSize: 6 });
  for (const query of [{ pageSize: 7 }, { pageSize: 0 }, { city: 'Orlando' }, { cursor: 'a'.repeat(513) }]) assert.equal(schemas.pageQuery.safeParse(query).success, false);
  for (const body of [{ kind: 'personal', handle: 'name' }, { kind: 'personal', hiddenEventIds: [] }, { kind: 'business' }, { kind: 'business', organizationId: id, title: 'Custom' }]) assert.equal(schemas.publish.safeParse(body).success, false);
  assert.deepEqual(schemas.previewQuery.parse({ kind: 'personal' }), { kind: 'personal', pageSize: 6 });
  assert.deepEqual(schemas.previewQuery.parse({ kind: 'business', organizationId: id }), { kind: 'business', organizationId: id, pageSize: 6 });
  for (const query of [{ kind: 'business' }, { kind: 'personal', organizationId: id }, { kind: 'personal', city: 'Orlando' }, { kind: 'personal', pageSize: 7 }]) assert.equal(schemas.previewQuery.safeParse(query).success, false);
  const previewCursor = { version: 2, kind: 'personal', ownerId: id, startsAt: cursor.startsAt, id: cursor.id };
  assert.deepEqual(decodePreviewRundownCursor(encode(previewCursor), 'personal', id), previewCursor);
  for (const [value,kind,ownerId] of [[encode(cursor),'personal',id], [encode(previewCursor),'personal',randomUUID()], [encode(previewCursor),'business',id], ['bad','personal',id]]) {
    assert.throws(() => decodePreviewRundownCursor(value,kind,ownerId), { code: 'INVALID_RUNDOWN_CURSOR', status: 422 });
  }
  assert.throws(() => decodeRundownCursor(encode(previewCursor), id), { code: 'INVALID_RUNDOWN_CURSOR', status: 422 });
});

test('pre-share personal preview reads a public event page in a snapshot without provisioning or referral writes', async () => {
  const userId = randomUUID(), eventId = randomUUID(), now = new Date(), future = new Date(+now + 3600000);
  let existing = null, profileReads = 0, eventReads = 0;
  const models = { User: { findByPk: async () => ({ id: userId, displayName: 'Current name', independentCreator: true, isActive: true }) },
    Rundown: { findOne: async () => { profileReads += 1; return existing; } },
    Event: { sequelize: { transaction: async (options, work) => { assert.equal(options.readOnly, true); assert.equal(options.isolationLevel, 'REPEATABLE READ'); return work({}); },
      query: async (sql, options) => { assert.match(sql, /e\.is_discoverable=true/); assert.equal(options.replacements.userId, userId); return [{ id: eventId, startsAt: now }]; } },
      findAll: async () => { eventReads += 1; return [{ id: eventId, title: 'Public night', startsAt: now, endsAt: future, offerings: [] }]; } } };
  const service = createRundownService({ models, customerAppUrl: 'https://example.test', now: () => now });
  const input = { kind: 'personal', pageSize: 6 }, beforeShare = await service.preview(userId, input);
  assert.deepEqual(beforeShare.profile, { kind: 'personal', name: 'Current name' }); assert.equal(beforeShare.items[0].id, eventId); assert.equal(beforeShare.items[0].referralCode, null);
  assert.equal(beforeShare.hasMore, false); assert.equal(beforeShare.nextCursor, null);
  existing = { id: randomUUID(), published: false }; assert.equal((await service.preview(userId, input)).items[0].referralCode, null);
  existing.published = true; assert.equal((await service.preview(userId, input)).items[0].referralCode, `RUN-${existing.id}`);
  assert.equal(profileReads, 3); assert.equal(eventReads, 3);
});

test('unpublished customer list is read-only and organization scope substitution preserves membership SQL aliases', async () => {
  let queries = 0, profileReads = 0;
  const models = { User: { findByPk: async () => ({ isActive: true, independentCreator: true, displayName: 'Current name' }) },
    Event: { sequelize: { query: async (sql) => {
      queries += 1; assert.equal(sql.includes('oorg.'), false); assert.match(sql, /oe\.organization_id = org\.id/);
      assert.match(sql, /oa\.organization_id = org\.id/); return [];
    } } }, Rundown: { findAll: async () => { profileReads += 1; return []; } } };
  const result = await createRundownService({ models, permissions: {}, customerAppUrl: 'https://example.test' }).list(randomUUID());
  assert.deepEqual(result, { items: [{ kind: 'personal', name: 'Current name', organizationId: null, published: false, canPublish: true, url: null }] });
  assert.equal(queries, 1); assert.equal(profileReads, 1);
});

function referralFixture() {
  const profile = { id: randomUUID(), userId: randomUUID(), published: true }, event = { id: randomUUID(), organizationId: randomUUID() };
  const user = { id: profile.userId, isActive: true }, member = { id: randomUUID(), userId: profile.userId, organizationId: event.organizationId, status: 'active' };
  let allowed = true, writes = 0, assignment = null;
  const models = {
    Rundown: { findByPk: async id => id === profile.id ? profile : null },
    User: { findByPk: async () => user, sequelize: { query: async () => [{ allowed: true }] } },
    Event: { sequelize: { query: async () => allowed ? [{ id: event.id }] : [] } },
    Organization: { findByPk: async () => ({ lifecycleState: 'active', status: 'active' }) },
    OrganizationOwner: { findOne: async () => null }, OrganizationEmployee: { findOne: async () => member.status === 'active' ? member : null },
    OrgAffiliate: { findOne: async () => null, findByPk: async () => null },
    EventAffiliate: { findOne: async ({ where }) => assignment && Object.entries(where).every(([key,value]) => assignment[key] === value) ? assignment : null,
      findOrCreate: async ({ defaults }) => { if (!assignment) { assignment = { id: randomUUID(), ...defaults }; writes += 1; } return [assignment, true]; } },
  };
  const resolve = (options = {}) => resolveAffiliate(models, { event, code: `RUN-${profile.id}`, ...options });
  return { profile, user, member, event, resolve, assignment: () => assignment, writes: () => writes, disallow: () => { allowed = false; } };
}

test('RUN preflight is pure and attribution lazily provisions one current assignment inside a transaction', async () => {
  const f = referralFixture();
  await assert.rejects(f.resolve({ code: `RUN-${'-'.repeat(36)}`, persist: false }), { code: 'INVALID_AFFILIATE' });
  const preflight = await f.resolve({ persist: false }); assert.equal(preflight.eventAffiliate.userId, f.profile.userId); assert.equal(preflight.configuredCommissionBps, 0);
  assert.equal(f.writes(), 0); await assert.rejects(f.resolve(), { code: 'INVALID_AFFILIATE' });
  const used = await f.resolve({ transaction: {} }); assert.equal(used.eventAffiliate.accessScope, 'organization'); assert.equal(f.writes(), 1);
  assert.equal((await f.resolve({ transaction: {} })).eventAffiliate.id, used.eventAffiliate.id); assert.equal(f.writes(), 1);
  f.assignment().commissionBps = 2300; f.assignment().guestlistAllocation = 7;
  const override = await f.resolve({ persist: false }); assert.equal(override.configuredCommissionBps, 2300); assert.equal(override.guestlistAllocation, 7);
  assert.equal(override.commissionBps, 0, 'current individual eligibility remains authoritative');
});

test('RUN aliases reject unpublished/business profiles, visibility removals, expired overrides and revoked membership', async () => {
  const f = referralFixture();
  f.profile.published = false; await assert.rejects(f.resolve({ persist: false }), { code: 'INVALID_AFFILIATE' });
  f.profile.published = true; const ownerId = f.profile.userId; f.profile.userId = null;
  await assert.rejects(f.resolve({ persist: false }), { code: 'INVALID_AFFILIATE' }); f.profile.userId = ownerId;
  await f.resolve({ transaction: {} }); const assignment = f.assignment();
  for (const update of [{ status: 'inactive', startsAt: null, endsAt: null }, { status: 'active', endsAt: new Date(Date.now() - 1000) },
    { status: 'active', startsAt: new Date(Date.now() + 3600000), endsAt: null }]) {
    Object.assign(assignment, update); await assert.rejects(f.resolve({ transaction: {} }), { code: 'INVALID_AFFILIATE' });
  }
  Object.assign(assignment, { status: 'active', startsAt: null, endsAt: null }); f.member.status = 'inactive';
  await assert.rejects(f.resolve({ transaction: {} }), { code: 'INVALID_AFFILIATE' }); f.member.status = 'active';
  f.disallow(); await assert.rejects(f.resolve({ transaction: {} }), { code: 'INVALID_AFFILIATE' }); assert.equal(f.writes(), 1);
});
