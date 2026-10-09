const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { request: httpRequest } = require('./support/http-client.cjs');
const { createSequelize } = require('../src/db/sequelize');
const { initModels } = require('../src/db/models');
const { createApp } = require('../src/app');
const { signToken } = require('../src/services/auth-service');
const { buildContract } = require('../src/http/contract-build');
const { resolveAffiliate } = require('../src/services/affiliate-service');
const { publicTarget } = require('../../shared/public-links.mjs');
const { createPublicSeoService } = require('../src/services/public-seo-service');

test('automatic personal and business rundowns preserve public visibility, scope and transactional referral rules', { timeout: 60000 }, async (t) => {
  assertManagedTestDatabase();
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const contracts = buildContract().contracts;
  const config = require('../src/config').getConfig(), sequelize = createSequelize(config), m = initModels(sequelize);
  const roles = ['owner','manager','employee','orgPromoter','promoter','venueManager','venueEmployee','venuePromoter','independent','ordinary','pending','buyer'];
  const ids = Object.fromEntries([...roles,'org','foreignOrg','location','otherLocation','foreignLocation','independentEvent','foreignEvent',
    'draft','unlisted','cancelled','completed','past','suspended','removed','expired','future','privateLocationEvent'].map(key => [key, randomUUID()]));
  const current = Date.now(), liveIds = Array.from({ length: 9 }, () => randomUUID()).sort(), tokens = new Map(), profiles = new Map();
  const seo = createPublicSeoService({ models: m, customerAppUrl: 'https://customer.offline.nitewide.test/' });
  let server;
  try {
    await m.User.bulkCreate(roles.map(role => ({ id: ids[role], email: `${role}-${ids.org}@offline.nitewide.test`, displayName: `Rundown ${role}`,
      independentCreator: role === 'independent', onboardingPending: role === 'pending' })));
    await m.Location.bulkCreate([
      { id: ids.location, name: 'Main Room', city: 'Orlando', timezone: 'America/New_York', addressLine1: '123 Public Street' },
      { id: ids.otherLocation, name: 'West Room', city: 'Los Angeles', timezone: 'America/Los_Angeles', privacy: 'attendees_only', addressLine1: '456 Secret Street', postalCode: '90001', latitude: 34, longitude: -118 },
      { id: ids.foreignLocation, name: 'Private address', city: 'Austin', timezone: 'America/Chicago', privacy: 'private', addressLine1: '789 Hidden Street' },
    ]);
    await m.Organization.bulkCreate([
      { id: ids.org, name: 'Rundown Business', slug: `rundown-${ids.org}`, locationId: ids.location, planTier: 'premium' },
      { id: ids.foreignOrg, name: 'Foreign Business', slug: `foreign-${ids.org}` },
    ]);
    await m.OrganizationVenue.bulkCreate([{ organizationId: ids.org, locationId: ids.location }, { organizationId: ids.org, locationId: ids.otherLocation }], { ignoreDuplicates: true });
    await m.OrganizationOwner.bulkCreate(['owner','manager','pending'].map(role => ({ organizationId: ids.org, userId: ids[role], role: role === 'owner' ? 'owner' : 'admin' })));
    await m.OrganizationEmployee.create({ organizationId: ids.org, userId: ids.employee });
    const orgPromoter = await m.OrgAffiliate.create({ organizationId: ids.org, userId: ids.orgPromoter, code: `ORG-${randomUUID()}`, defaultCommissionBps: 900, defaultGuestlistAllocation: 4 });
    const grants = new Map();
    for (const role of ['venueManager','venueEmployee','venuePromoter']) grants.set(role, await m.VenueAccess.create({ organizationId: ids.org, locationId: ids.location, userId: ids[role], role: role.replace('venue','').toLowerCase() }));
    await m.Event.bulkCreate(liveIds.map((id,index) => ({ id, creatorUserId: ids.owner, organizationId: ids.org,
      locationId: index % 2 ? ids.otherLocation : ids.location, title: `Public event ${index}`, slug: `public-${index}-${ids.org}`,
      status: 'published', startsAt: new Date(current + (index === 0 ? -3600000 : 3600000)), endsAt: new Date(current + 14400000), guestlistCapacity: 30,
      feeMode: 'absorbed', commissionMinimumSubtotalCents: 1200 })));
    await m.Event.bulkCreate(['draft','unlisted','cancelled','completed','past','suspended','removed','expired','future','privateLocationEvent'].map(kind => ({
      id: ids[kind], creatorUserId: ids.owner, organizationId: ids.org, locationId: kind === 'privateLocationEvent' ? ids.foreignLocation : ids.location,
      title: `Special ${kind}`, slug: `special-${kind}-${ids.org}`, status: ['draft','cancelled','completed'].includes(kind) ? kind : 'published',
      lifecycleState: kind === 'suspended' ? 'suspended' : 'active', isDiscoverable: kind !== 'unlisted',
      startsAt: new Date(current + (kind === 'past' ? -7200000 : 7200000)), endsAt: new Date(current + (kind === 'past' ? -3600000 : 18000000)), guestlistCapacity: 20,
    })));
    await m.Event.bulkCreate([
      { id: ids.independentEvent, creatorUserId: ids.independent, title: 'Independent', slug: `independent-${ids.org}`, status: 'published', startsAt: new Date(current + 3600000), endsAt: new Date(current + 7200000), guestlistCapacity: 20 },
      { id: ids.foreignEvent, creatorUserId: ids.owner, organizationId: ids.foreignOrg, title: 'Foreign', slug: `foreign-event-${ids.org}`, status: 'published', startsAt: new Date(current + 3600000), endsAt: new Date(current + 7200000) },
    ]);
    const override = await m.EventAffiliate.create({ eventId: liveIds[0], userId: ids.promoter, code: `EVENT-${randomUUID()}`, commissionBps: 1700, guestlistAllocation: 3, accessScope: 'event' });
    await m.EventAffiliate.bulkCreate(['removed','expired','future'].map(kind => ({ eventId: ids[kind], userId: ids.owner, code: `OVERRIDE-${randomUUID()}`, accessScope: 'organization',
      status: kind === 'removed' ? 'inactive' : 'active', endsAt: kind === 'expired' ? new Date(current - 1000) : null, startsAt: kind === 'future' ? new Date(current + 100000) : null })));
    const offerings = await m.Offering.bulkCreate([
      { eventId: liveIds[0], name: 'Public admission', priceCents: 2000, quantityTotal: 50, feeMode: 'inherit' },
      { eventId: liveIds[0], name: 'Private admission', priceCents: 1, quantityTotal: 50, visibility: 'password', accessCodeHash: 'a'.repeat(64) },
      { eventId: liveIds[0], name: 'Hidden admission', priceCents: 1, quantityTotal: 50, visibility: 'hidden' },
      { eventId: liveIds[0], name: 'Inactive admission', priceCents: 1, quantityTotal: 50, isActive: false },
    ], { returning: true });
    const accountId = `acct_rundown_${ids.promoter.replaceAll('-','')}`;
    await m.IndividualCommissionProfile.create({ userId: ids.promoter, name: 'Personal earnings', creationRequestId: randomUUID(), stripeAccountId: accountId, verifiedAt: new Date(),
      verifiedStripeAccount: { id: accountId, object: 'v2.core.account', livemode: false, identity: { entity_type: 'individual' }, dashboard: 'full',
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } }, applied_configurations: ['merchant'],
        configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] } } });
    server = createApp({ sequelize, models: m, config }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    for (const role of roles) {
      const issuedAt = Math.floor(Date.now() / 1000), session = await m.AuthSession.create({ userId: ids[role], expiresAt: new Date((issuedAt + 600) * 1000) });
      tokens.set(role, signToken({ sub: ids[role], sid: session.id, iat: issuedAt, exp: issuedAt + 600, pwd: null }, config.AUTH_TOKEN_SECRET));
    }
    const request = (path, role = 'owner', options = {}) => httpRequest(server, `/api${path}`, { ...options, token: tokens.get(role) });
    const share = (role, body = { kind: 'personal' }) => request('/customer/rundowns', role, { method: 'POST', body });
    const page = (id, suffix = '') => request(`/rundowns/${id}${suffix}`, null);
    const preview = (role = 'owner', kind = 'personal', organizationId, cursor) => request(`/customer/rundowns/preview?kind=${kind}${organizationId ? `&organizationId=${organizationId}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, role);
    const wire = (path, response, method = 'get') => {
      const schema = contracts.find(candidate => candidate.path === path && candidate.method === method)?.responseSchemas[response.status];
      assert.equal(schema?.safeParse(response.body).success, true, JSON.stringify(schema?.safeParse(response.body).error || response.body));
    };
    const counts = async () => Promise.all([m.Rundown.count(), m.EventAffiliate.count(), m.AffiliateAttribution.count(), m.GuestlistEntry.count(), m.Order.count(), m.AuditLog.count(), m.EmailOutbox.count(), m.NotificationJob.count()]);
    const allPages = async (id) => {
      const events = []; let cursor = null;
      do { const response = await page(id, cursor ? `?pageSize=6&cursor=${encodeURIComponent(cursor)}` : '?pageSize=6');
        assert.equal(response.status, 200, JSON.stringify(response.body)); wire('/rundowns/:id', response); events.push(...response.body.data.items); cursor = response.body.data.nextCursor;
      } while (cursor);
      return events;
    };
    const allPreviewPages = async (role, kind = 'personal', organizationId) => {
      const events = []; let cursor = null;
      do { const response = await preview(role, kind, organizationId, cursor);
        assert.equal(response.status, 200, JSON.stringify(response.body)); wire('/customer/rundowns/preview', response);
        events.push(...response.body.data.items); cursor = response.body.data.nextCursor;
      } while (cursor);
      return events;
    };
    // Surface any SQL/fixture error directly while the remaining regressions
    // exercise the redacted HTTP error boundary.
    await require('../src/services/rundown-service').createRundownService({ models: m,
      permissions: require('../src/services/permission-service').createPermissionService(m), customerAppUrl: config.CUSTOMER_APP_URL }).list(ids.owner);
    await t.test('authenticated pre-share preview is populated, scoped, paginated and completely read-only', async () => {
      const before = await counts();
      assert.equal((await preview(null)).status, 401);
      for (const role of ['ordinary','buyer']) assert.equal((await preview(role)).status, 403);
      assert.equal((await preview('pending')).status, 401);
      const personal = await preview(); assert.equal(personal.status, 200, JSON.stringify(personal.body)); wire('/customer/rundowns/preview', personal);
      assert.equal(personal.headers['cache-control'], 'no-store'); assert.equal(personal.body.data.profile.name, 'Rundown owner');
      assert.equal(personal.body.data.items.length, 6); assert.equal(personal.body.data.hasMore, true);
      assert.equal(personal.body.data.items[0].id, liveIds[0]); assert.ok(personal.body.data.items.every(event => event.referralCode === null));
      const cursor = personal.body.data.nextCursor, second = await preview('owner', 'personal', undefined, cursor);
      assert.equal(second.status, 200); wire('/customer/rundowns/preview', second);
      assert.deepEqual([...personal.body.data.items, ...second.body.data.items].map(event => event.id), [...liveIds, ids.privateLocationEvent]);
      assert.equal((await preview('employee', 'personal', undefined, cursor)).status, 422, 'personal cursors cannot cross actors');
      assert.equal((await preview('owner', 'business', ids.org, cursor)).status, 422, 'personal cursors cannot cross preview kinds');
      for (const role of ['owner','manager','employee','orgPromoter','promoter','venueManager','venueEmployee','venuePromoter']) {
        const business = await preview(role, 'business', ids.org); assert.equal(business.status, 200, JSON.stringify(business.body)); wire('/customer/rundowns/preview', business);
        assert.equal(business.body.data.profile.name, 'Rundown Business'); assert.equal(business.body.data.items.length, 6); assert.ok(business.body.data.items.every(event => event.referralCode === null));
      }
      assert.equal((await preview('owner', 'business', ids.foreignOrg)).status, 403);
      assert.equal((await preview('independent', 'business', ids.org)).status, 403);
      assert.deepEqual((await preview('independent')).body.data.items.map(event => event.id), [ids.independentEvent]);
      assert.deepEqual((await preview('promoter')).body.data.items.map(event => event.id), [liveIds[0]]);
      assert.deepEqual((await allPreviewPages('venuePromoter')).map(event => event.id), liveIds.filter((_, index) => index % 2 === 0).concat([ids.removed, ids.expired, ids.future]).sort((a,b) => {
        const indexA = liveIds.indexOf(a), indexB = liveIds.indexOf(b); return (indexA < 0 ? 2 : indexA === 0 ? 0 : 1) - (indexB < 0 ? 2 : indexB === 0 ? 0 : 1) || a.localeCompare(b);
      }));
      for (const suffix of ['?kind=business', `?kind=personal&organizationId=${ids.org}`, '?kind=personal&pageSize=7', '?kind=personal&city=Orlando', '?kind=personal&cursor=garbage', '?kind=unknown']) {
        assert.equal((await request(`/customer/rundowns/preview${suffix}`)).status, 422, suffix);
      }
      const protectedVenue = personal.body.data.items.find(event => event.location?.privacy === 'attendees_only');
      assert.equal('addressLine1' in protectedVenue.location, false); assert.equal('paymentAccountId' in personal.body.data.items[0], false);
      const pub = personal.body.data.items[0].offerings; assert.equal(pub.length, 1); assert.equal(pub[0].priceCents, 2000); assert.equal(pub[0].effectiveFeeMode, 'absorbed');
      assert.deepEqual(await counts(), before, 'preview must not provision links, attribution, visits, orders, audit, email or jobs');
    });
    await t.test('approved customer gate, GET has no provisioning and all eligible team can provision a stable share link', async () => {
      const before = await counts();
      assert.equal((await request('/customer/rundowns', null)).status, 401);
      for (const role of ['ordinary','buyer']) assert.equal((await request('/customer/rundowns', role)).status, 403);
      assert.equal((await request('/customer/rundowns', 'pending')).status, 401);
      for (const role of ['owner','manager','employee','orgPromoter','promoter','venueManager','venueEmployee','venuePromoter','independent']) {
        const response = await request('/customer/rundowns', role); assert.equal(response.status, 200, JSON.stringify(response.body)); wire('/customer/rundowns', response);
        assert.equal(response.body.data.items[0].kind, 'personal'); assert.equal(response.body.data.items[0].url, null);
        const business = response.body.data.items.find(item => item.organizationId === ids.org);
        if (role !== 'independent') { assert.ok(business); assert.equal(business.canPublish, true); }
        else assert.equal(response.body.data.items.length, 1);
      }
      assert.deepEqual(await counts(), before);
      for (const role of ['employee','orgPromoter','promoter','venueManager']) assert.equal((await share(role, { kind: 'business', organizationId: ids.org })).status, 200);
      assert.equal((await share('owner', { kind: 'personal', handle: 'custom' })).status, 422);
      assert.equal((await share('owner', { kind: 'personal', hiddenEventIds: [liveIds[0]] })).status, 422);
      assert.equal((await share('owner', { kind: 'business', organizationId: ids.foreignOrg })).status, 403);
      for (const role of ['owner','employee','orgPromoter','promoter','venueManager','venueEmployee','venuePromoter','independent']) {
        const [response, concurrent] = await Promise.all([share(role), share(role)]); assert.equal(response.status, 200, JSON.stringify(response.body)); wire('/customer/rundowns', response, 'post');
        assert.equal(concurrent.status, 200, JSON.stringify(concurrent.body)); assert.equal(concurrent.body.data.url, response.body.data.url);
        const publicId = publicTarget(new URL(response.body.data.url).pathname).id; assert.notEqual(publicId, ids[role]); profiles.set(role, publicId);
        assert.equal(new URL(response.body.data.url).pathname, `/rundowns/${publicId}`); assert.equal(new URL(response.body.data.url).searchParams.size, 0);
        const repeated = await share(role); assert.equal(repeated.body.data.url, response.body.data.url);
      }
      const business = await share('manager', { kind: 'business', organizationId: ids.org }); assert.equal(business.status, 200); profiles.set('business', publicTarget(new URL(business.body.data.url).pathname).id);
      for (const role of ['employee','orgPromoter','promoter','venueManager']) {
        const response = await share(role, { kind: 'business', organizationId: ids.org }); assert.equal(response.status, 200); assert.equal(response.body.data.url, business.body.data.url); assert.equal(response.body.data.canPublish, true);
      }
      assert.equal(await m.Rundown.count(), profiles.size);
      assert.equal(await m.EventAffiliate.count(), before[1], 'publish must not provision per-event attribution');
      const privateProfile = await m.Rundown.create({ userId: ids.manager, published: false }); assert.equal((await page(privateProfile.id)).status, 404);
      const beforePreview = await counts();
      assert.ok((await preview('manager')).body.data.items.every(event => event.referralCode === null), 'an unpublished internal profile grants no public alias');
      assert.ok((await preview('owner')).body.data.items.every(event => event.referralCode === `RUN-${profiles.get('owner')}`));
      const publicCursor = (await page(profiles.get('owner'))).body.data.nextCursor;
      assert.equal((await preview('owner', 'personal', undefined, publicCursor)).status, 422, 'public cursors cannot be used for private preview');
      const previewCursor = (await preview('owner')).body.data.nextCursor;
      assert.equal((await page(profiles.get('owner'), `?cursor=${encodeURIComponent(previewCursor)}`)).status, 422, 'preview cursors cannot be used publicly');
      assert.deepEqual(await counts(), beforePreview);
      assert.equal((await page(randomUUID())).status, 404);
      await assert.rejects(m.Rundown.bulkCreate([{ userId: ids.ordinary, organizationId: ids.org }]), error => error.parent?.code === '23514', 'database enforces exactly one owner');
      await assert.rejects(m.Rundown.create({ userId: ids.owner, published: true }), error => error.name === 'SequelizeUniqueConstraintError', 'database prevents duplicate personal links');
    });
    await t.test('SEO reads and partitioned sitemaps use current public visibility and owner access without provisioning or attribution writes', async () => {
      const before = await counts();
      const eventUrls = await seo.sitemap('events');
      const eventIds = eventUrls.map(url => publicTarget(new URL(url).pathname).id);
      for (const excluded of ['draft', 'unlisted', 'cancelled', 'completed', 'past', 'suspended']) assert.equal(eventIds.includes(ids[excluded]), false, excluded);
      assert.ok(liveIds.every(id => eventIds.includes(id)));
      const direct = await seo.event(liveIds[0]); assert.equal(direct.indexable, true); assert.equal(direct.event.offerings.length, 1);
      assert.equal((await seo.event(ids.unlisted)).indexable, false, 'existing unlisted links remain usable, never indexed');
      assert.equal((await seo.event(ids.past)).indexable, false);
      await assert.rejects(seo.event(ids.draft), { status: 404 });
      for (const id of [liveIds[1], ids.privateLocationEvent]) {
        const content = JSON.stringify((await seo.event(id)).event);
        assert.doesNotMatch(content, /456 Secret Street|789 Hidden Street|latitude|postalCode|accessCodeHash|commissionMinimumSubtotalCents/);
      }
      const page = await seo.rundown(profiles.get('promoter')); assert.equal(page.items[0].referralCode, `RUN-${profiles.get('promoter')}`);
      const rundownUrls = await seo.sitemap('rundowns'); assert.ok([...profiles.values()].every(id => rundownUrls.includes(`https://customer.offline.nitewide.test/rundowns/${id}`)));
      const employeeProfile = await m.Rundown.findByPk(profiles.get('employee'));
      await employeeProfile.update({ published: false });
      assert.equal((await seo.sitemap('rundowns')).includes(`https://customer.offline.nitewide.test/rundowns/${profiles.get('employee')}`), false);
      await assert.rejects(seo.rundown(profiles.get('employee')), { status: 404 });
      await employeeProfile.update({ published: true });
      assert.ok((await seo.home()).items.length <= 12);
      assert.deepEqual(await seo.sitemapIndex(), [{ kind: 'static', page: 1 }, { kind: 'events', page: 1 }, { kind: 'rundowns', page: 1 }]);
      await assert.rejects(seo.sitemap('events', 2), { status: 404 });
      for (const page of [0, -1, 1.5, 1000001]) await assert.rejects(seo.sitemap('events', page), { status: 404 });
      assert.deepEqual(await counts(), before, 'SEO never creates profiles, assignments, referral visits, orders or provider jobs');
    });
    await t.test('six-card keyset pages are stable across cities and exclude event removals and nonpublic states', async () => {
      const before = await counts(), first = await page(profiles.get('owner'), '?pageSize=6');
      assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.data.items.length, 6); assert.equal(first.body.data.hasMore, true);
      assert.equal(first.body.data.items[0].id, liveIds[0], 'ongoing public event appears first'); assert.equal(first.headers['cache-control'], 'no-store');
      const personal = await allPages(profiles.get('owner')), business = await allPages(profiles.get('business'));
      assert.deepEqual(personal.map(event => event.id), [...liveIds, ids.privateLocationEvent]);
      assert.deepEqual(new Set(business.map(event => event.id)), new Set([...liveIds, ids.removed, ids.expired, ids.future, ids.privateLocationEvent]));
      assert.ok(personal.some(event => event.location?.city === 'Los Angeles')); assert.ok(personal.every(event => event.referralCode === `RUN-${profiles.get('owner')}`));
      assert.ok(business.every(event => event.referralCode === null)); assert.deepEqual(await counts(), before, 'anonymous list reads have no side effects');
      const second = await page(profiles.get('owner'), `?cursor=${encodeURIComponent(first.body.data.nextCursor)}`);
      assert.deepEqual(second.body.data.items.map(event => event.id), personal.slice(6).map(event => event.id));
      assert.equal((await page(profiles.get('business'), `?cursor=${encodeURIComponent(first.body.data.nextCursor)}`)).status, 422);
      for (const suffix of ['?pageSize=7','?pageSize=0','?cursor=garbage','?city=Orlando']) assert.equal((await page(profiles.get('owner'), suffix)).status, 422);
      await m.User.update({ displayName: 'Current Name' }, { where: { id: ids.owner } });
      await m.Organization.update({ name: 'Current Business' }, { where: { id: ids.org } });
      assert.equal((await page(profiles.get('owner'))).body.data.profile.name, 'Current Name');
      assert.equal((await page(profiles.get('business'))).body.data.profile.name, 'Current Business');
      assert.equal((await preview('owner')).body.data.profile.name, 'Current Name');
      assert.equal((await preview('employee', 'business', ids.org)).body.data.profile.name, 'Current Business');
    });
    await t.test('public allowlist redacts operational fields, password tiers and attendee/private addresses without losing prices', async () => {
      const events = await allPages(profiles.get('owner')), event = events.find(event => event.id === liveIds[0]);
      assert.equal(event.isPremiumHost, true); assert.equal(event.offerings.length, 1); assert.equal(event.offerings[0].priceCents, 2000); assert.equal(event.offerings[0].effectiveFeeMode, 'absorbed');
      for (const key of ['creatorUserId','paymentAccountId','commissionMinimumSubtotalCents','capacity','version','lifecycleState','imageAssetId','createdAt']) assert.equal(key in event, false, key);
      for (const key of ['accessCodeHash','quantityReserved','releaseAfterOfferingId','createdAt']) assert.equal(key in event.offerings[0], false, key);
      assert.equal(event.location.addressLine1, '123 Public Street');
      for (const venue of events.map(event => event.location).filter(location => location && location.privacy !== 'public')) {
        for (const key of ['addressLine1','addressLine2','postalCode','latitude','longitude','geo','geocodeAddressHash','geocodeAttempts']) assert.equal(key in venue, false, key);
      }
    });
    await t.test('personal scopes combine current organizations, exact venue grants, standalone and independent assignments', async () => {
      assert.deepEqual((await allPages(profiles.get('promoter'))).map(event => event.id), [liveIds[0]]);
      assert.deepEqual((await allPages(profiles.get('independent'))).map(event => event.id), [ids.independentEvent]);
      for (const role of ['venueManager','venueEmployee','venuePromoter']) assert.deepEqual((await allPages(profiles.get(role))).map(event => event.id), liveIds.filter((_,index) => index % 2 === 0).concat([ids.removed,ids.expired,ids.future]).sort((a,b) => {
        const indexA = liveIds.indexOf(a), indexB = liveIds.indexOf(b); return (indexA < 0 ? 2 : indexA === 0 ? 0 : 1) - (indexB < 0 ? 2 : indexB === 0 ? 0 : 1) || a.localeCompare(b);
      }));
      await m.OrganizationEmployee.create({ organizationId: ids.foreignOrg, userId: ids.employee });
      assert.ok((await allPages(profiles.get('employee'))).some(event => event.id === ids.foreignEvent), 'one personal link updates across businesses');
      const businessPreviewCursor = (await preview('employee', 'business', ids.org)).body.data.nextCursor;
      assert.equal((await preview('employee', 'business', ids.foreignOrg, businessPreviewCursor)).status, 422, 'business cursors cannot cross accessible organizations');
      assert.deepEqual((await preview('employee', 'business', ids.foreignOrg)).body.data.items.map(event => event.id), [ids.foreignEvent]);
      await m.OrganizationEmployee.update({ status: 'inactive' }, { where: { organizationId: ids.foreignOrg, userId: ids.employee } });
      assert.equal((await allPages(profiles.get('employee'))).some(event => event.id === ids.foreignEvent), false);
      assert.equal((await preview('employee', 'business', ids.foreignOrg)).status, 403, 'preview rechecks a removed membership each page');
    });
    await t.test('public reads and referral preflight remain pure; real booking and guestlist use existing event terms', async () => {
      const code = `RUN-${profiles.get('promoter')}`, event = await m.Event.findByPk(liveIds[0]), before = await counts();
      const preflight = await resolveAffiliate(m, { event, code, persist: false }); assert.equal(preflight.eventAffiliate.id, override.id); assert.equal(preflight.configuredCommissionBps, 1700); assert.equal(preflight.guestlistAllocation, 3);
      const staffEvent = await m.Event.findByPk(liveIds[1]), staffCode = `RUN-${profiles.get('employee')}`;
      const staff = await resolveAffiliate(m, { event: staffEvent, code: staffCode, persist: false }); assert.equal(staff.configuredCommissionBps, 0); assert.deepEqual(await counts(), before);
      const purchased = await request('/orders', 'buyer', { method: 'POST', body: { eventId: liveIds[0], affiliateCode: code, items: [{ offeringId: offerings[0].id, quantity: 1 }], idempotencyKey: randomUUID(), payment: { provider: 'demo', status: 'succeeded', reference: randomUUID() } } });
      assert.equal(purchased.status, 201, JSON.stringify(purchased.body)); const order = await m.Order.findByPk(purchased.body.data.order.id);
      assert.equal(order.eventAffiliateId, override.id); assert.equal(order.affiliateCommissionCents, 340); assert.equal(order.commissionSnapshot.configuredCommissionBps, 1700);
      const guest = await request(`/events/${liveIds[0]}/guestlist`, 'buyer', { method: 'POST', body: { affiliateCode: code, partySize: 2 } });
      assert.equal(guest.status, 202, JSON.stringify(guest.body)); assert.equal(guest.body.data.entry.eventAffiliateId, override.id);
      const lazy = await request(`/events/${liveIds[1]}/guestlist`, 'buyer', { method: 'POST', body: { affiliateCode: staffCode, partySize: 1 } });
      assert.equal(lazy.status, 202, JSON.stringify(lazy.body)); const assignment = await m.EventAffiliate.findByPk(lazy.body.data.entry.eventAffiliateId);
      assert.equal(assignment.userId, ids.employee); assert.equal(assignment.accessScope, 'organization'); assert.equal(assignment.commissionBps, 0);
      const original = await override.reload(); assert.equal(original.commissionBps, 1700); assert.equal(original.guestlistAllocation, 3);
      const orgCode = `RUN-${profiles.get('orgPromoter')}`, defaults = await resolveAffiliate(m, { event: staffEvent, code: orgCode, persist: false });
      assert.equal(defaults.configuredCommissionBps, orgPromoter.defaultCommissionBps); assert.equal(defaults.guestlistAllocation, 4); assert.equal(defaults.commissionBps, 0, 'individual onboarding guard remains');
      const independentEvent = await m.Event.findByPk(ids.independentEvent), independent = await resolveAffiliate(m, { event: independentEvent, code: `RUN-${profiles.get('independent')}`, persist: false });
      assert.equal(independent.configuredCommissionBps, 0); assert.equal(independent.eventAffiliate.accessScope, 'event');
      const independentGuest = await request(`/events/${ids.independentEvent}/guestlist`, 'buyer', { method: 'POST', body: { affiliateCode: `RUN-${profiles.get('independent')}`, partySize: 1 } });
      assert.equal(independentGuest.status, 202, JSON.stringify(independentGuest.body));
      const independentAssignment = await m.EventAffiliate.findByPk(independentGuest.body.data.entry.eventAffiliateId);
      assert.equal(independentAssignment.userId, ids.independent); assert.equal(independentAssignment.accessScope, 'event'); assert.equal(independentAssignment.commissionBps, 0);
      const orgGuest = await request(`/events/${liveIds[2]}/guestlist`, 'buyer', { method: 'POST', body: { affiliateCode: orgCode, partySize: 1 } });
      assert.equal(orgGuest.status, 202, JSON.stringify(orgGuest.body));
      const orgAssignment = await m.EventAffiliate.findByPk(orgGuest.body.data.entry.eventAffiliateId);
      assert.equal(orgAssignment.orgAffiliateId, orgPromoter.id); assert.equal(orgAssignment.commissionBps, null); assert.equal(orgAssignment.guestlistAllocation, null);
      const venueCode = `RUN-${profiles.get('venuePromoter')}`;
      await assert.rejects(resolveAffiliate(m, { event: staffEvent, code: venueCode, persist: false }), { code: 'INVALID_AFFILIATE' });
      const venueVisit = await request(`/events/${liveIds[0]}/referral-visits`, null, { method: 'POST', body: { code: venueCode, sessionKey: randomUUID() } });
      assert.equal(venueVisit.status, 200, JSON.stringify(venueVisit.body));
      const venueAssignment = await m.EventAffiliate.findOne({ where: { eventId: liveIds[0], userId: ids.venuePromoter } });
      assert.equal(venueAssignment.accessScope, 'venue'); assert.equal(venueAssignment.venueAccessId, grants.get('venuePromoter').id);
    });
    await t.test('expiry, explicit removal, visibility and exact venue revocation reject old aliases without revival', async () => {
      const code = `RUN-${profiles.get('promoter')}`, before = await counts();
      for (const update of [{ status: 'inactive', endsAt: null, startsAt: null }, { status: 'active', endsAt: new Date(Date.now() - 1000) }, { status: 'active', endsAt: null, startsAt: new Date(Date.now() + 100000) }]) {
        await override.update(update); assert.equal((await page(profiles.get('promoter'))).status, 404);
        assert.equal((await seo.sitemap('rundowns')).includes(`https://customer.offline.nitewide.test/rundowns/${profiles.get('promoter')}`), false);
        const denied = await request(`/events/${liveIds[0]}/referral-visits`, null, { method: 'POST', body: { code, sessionKey: randomUUID() } });
        assert.equal(denied.status, 400, JSON.stringify(denied.body)); assert.equal(denied.body.error.code, 'INVALID_AFFILIATE');
      }
      await override.update({ status: 'active', startsAt: null, endsAt: null });
      await m.Event.update({ isDiscoverable: false }, { where: { id: liveIds[0] } });
      assert.deepEqual((await allPages(profiles.get('promoter'))).map(event => event.id), []);
      assert.equal((await request(`/events/${liveIds[0]}/referral-visits`, null, { method: 'POST', body: { code } })).status, 400);
      await m.Event.update({ isDiscoverable: true }, { where: { id: liveIds[0] } });
      await grants.get('venuePromoter').update({ status: 'inactive' });
      assert.equal((await page(profiles.get('venuePromoter'))).status, 404);
      assert.equal((await preview('venuePromoter')).status, 403);
      assert.equal((await preview('venuePromoter', 'business', ids.org)).status, 403);
      assert.equal((await share('venuePromoter', { kind: 'business', organizationId: ids.org })).status, 403);
      await m.User.update({ isActive: false }, { where: { id: ids.promoter } }); assert.equal((await page(profiles.get('promoter'))).status, 404);
      await m.Organization.update({ lifecycleState: 'suspended', status: 'suspended' }, { where: { id: ids.org } });
      assert.equal((await page(profiles.get('business'))).status, 404); assert.equal((await page(profiles.get('owner'))).status, 404);
      const finalSitemap = await seo.sitemap('rundowns');
      for (const role of ['business', 'owner', 'venuePromoter', 'promoter']) assert.equal(finalSitemap.includes(`https://customer.offline.nitewide.test/rundowns/${profiles.get(role)}`), false, role);
      assert.equal((await preview('owner', 'business', ids.org)).status, 403); assert.equal((await preview('owner')).status, 403);
      assert.deepEqual(await counts(), before, 'denied attribution must not write or revive assignments');
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await sequelize.close();
  }
});
