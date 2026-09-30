const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { createFixture, cleanupFixture } = require('./admissions-fixture.cjs');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');

test('customer experience HTTP: account saved events, paged history, guestlist state and attendee-only venue details', async () => {
  assertManagedTestDatabase();
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const { signToken } = require('../src/services/auth-service');
  const config = getConfig(), sequelize = createSequelize(config), m = initModels(sequelize);
  let fixture, server;
  const extraEvents = [], extraAffiliates = [], extraLocations = [], extraUsers = [], extraOrderIds = [], notificationIds = [];
  try {
    fixture = await createFixture(m, config);
    const { ids } = fixture;
    await m.Event.update({ guestlistCapacity: 30 }, { where: { id: ids.event } });
    // A quota-free email mock exercises the real verification throttle through
    // the profile HTTP route without ever connecting to an email provider.
    const queuedTemplates = [];
    const emailMock = { enabled: true, queue: async ({ template }) => { queuedTemplates.push(template); return `mock-email-${queuedTemplates.length}`; } };
    const app = createApp({ sequelize, models: m, config, services: { email: emailMock } });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(pathname, role = 'guest', { method = 'GET', body } = {}) {
      const credential = role ? await m.UserCredential.findByPk(ids[role]) : null;
      const issuedAt = Math.floor(Date.now() / 1000);
      const session = role ? await m.AuthSession.create({ userId: ids[role], expiresAt: new Date((issuedAt + 300) * 1000) }) : null;
      const token = role ? signToken({ sub: ids[role], sid: session.id, iat: issuedAt, exp: issuedAt + 300, pwd: credential?.passwordChangedAt ? new Date(credential.passwordChangedAt).getTime() : null }, config.AUTH_TOKEN_SECRET) : null;
      const response = await fetch(base + pathname, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, ...await response.json() };
    }

    const changedEmail = `customer-${ids.guest}@new.nitewide.test`;
    const currentGuest = await m.User.findByPk(ids.guest);
    await currentGuest.update({ emailVerifiedAt: new Date(), phone: '+14075550111', phoneVerifiedAt: new Date() });
    await m.UserActionToken.bulkCreate([1, 2, 3].map((value) => ({
      userId: ids.guest, purpose: 'verify_email', email: currentGuest.email,
      tokenHash: String(value).repeat(64), expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })));
    const mismatchedIdentity = await request('/auth/profile', 'guest', { method: 'PATCH', body: {
      displayName: 'Admissions QA guest', email: changedEmail, confirmEmail: changedEmail,
      phone: '+14075550123', confirmPhone: '+14075550124',
    } });
    assert.equal(mismatchedIdentity.status, 409, JSON.stringify(mismatchedIdentity));
    assert.equal((await m.User.findByPk(ids.guest)).email, currentGuest.email, 'a mismatched repeat phone value preserves both existing identity fields');
    const updatedIdentity = await request('/auth/profile', 'guest', { method: 'PATCH', body: {
      displayName: 'Admissions QA guest', email: changedEmail, confirmEmail: changedEmail,
      phone: '+14075550123', confirmPhone: '+14075550123',
    } });
    assert.equal(updatedIdentity.status, 200, JSON.stringify(updatedIdentity));
    assert.equal(updatedIdentity.data.email, changedEmail);
    assert.equal(updatedIdentity.data.phone, '+14075550123');
    assert.equal(updatedIdentity.data.emailVerifiedAt, null);
    assert.equal(updatedIdentity.data.phoneVerifiedAt, null);
    assert.equal(updatedIdentity.data.verificationEmailQueued, false, 'the profile truthfully reports when the verification rate limit prevents queueing');
    assert.equal(await m.UserActionToken.count({ where: { userId: ids.guest, purpose: 'verify_email' } }), 3, 'rate-limited verification does not create another action token');
    assert.equal(queuedTemplates.includes('nitewide-verify-email'), false, 'the quota-free mock confirms no verification was queued');
    const profileBody = { displayName: 'Admissions QA guest', phone: '+14075550999', marketingConsent: false, transactionalSmsConsent: true, marketingSmsConsent: false };
    assert.equal((await request('/customer/profile', 'guest', { method: 'PATCH', body: profileBody })).status, 409, 'the profile editor requires a repeated phone value');
    const savedProfile = await request('/customer/profile', 'guest', { method: 'PATCH', body: { ...profileBody, confirmPhone: '+14075550999' } });
    assert.equal(savedProfile.status, 200, JSON.stringify(savedProfile));
    assert.equal(savedProfile.data.phone, '+14075550999');
    assert.equal(savedProfile.data.phoneVerifiedAt, null);

    // Saved events belong to the signed-in account, merge duplicate guest saves
    // idempotently, and retain an event until it ends rather than dropping it at
    // its start time.
    assert.equal((await request('/customer/saved', null)).status, 401);
    await m.Event.update({ startsAt: new Date(Date.now() - 60 * 60 * 1000), endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000) }, { where: { id: ids.event } });
    const merge = await request('/customer/saved/merge', 'guest', { method: 'POST', body: { eventIds: [ids.event, ids.event] } });
    assert.equal(merge.status, 200, JSON.stringify(merge));
    assert.equal(merge.data.added, 1);
    const repeatedMerge = await request('/customer/saved/merge', 'guest', { method: 'POST', body: { eventIds: [ids.event] } });
    assert.deepEqual(repeatedMerge.data, { added: 0, skipped: 1 }, 'merging an already saved event is idempotent and reports it as skipped');
    await m.Event.update({ startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000), endsAt: new Date(Date.now() + 5 * 60 * 60 * 1000) }, { where: { id: ids.otherEvent } });
    assert.equal((await request('/customer/saved/merge', 'outsider', { method: 'POST', body: { eventIds: [ids.otherEvent] } })).data.added, 1);
    await request(`/customer/saved/${ids.otherEvent}`, 'guest', { method: 'PUT' });
    const guestSaved = await request('/customer/saved');
    const otherSaved = await request('/customer/saved', 'outsider');
    assert.equal(guestSaved.data.total, 2);
    assert.ok(guestSaved.data.items.some((item) => item.id === ids.event));
    const fullCard = guestSaved.data.items.find((item) => item.id === ids.event);
    assert.ok(Array.isArray(fullCard.offerings), 'saved API returns the same complete event-card data as discovery');
    assert.equal(fullCard.offerings[0].name, 'VIP · 2 admissions');
    assert.equal(otherSaved.data.total, 1, 'a guest merge only affects its authenticated account');
    assert.deepEqual(otherSaved.data.items.map((item) => item.id), [ids.otherEvent], 'the second account sees only its own saved row');
    const firstSavedPage = await request('/customer/saved?page=1&pageSize=1');
    const secondSavedPage = await request('/customer/saved?page=2&pageSize=1');
    assert.equal(firstSavedPage.data.items.length, 1);
    assert.equal(firstSavedPage.data.hasMore, true);
    assert.equal(secondSavedPage.data.items.length, 1);
    assert.notEqual(firstSavedPage.data.items[0].id, secondSavedPage.data.items[0].id);
    const unsave = await request(`/customer/saved/${ids.event}`, 'guest', { method: 'DELETE' });
    assert.equal(unsave.status, 200, JSON.stringify(unsave));
    assert.equal((await request('/customer/saved')).data.total, 1);
    await request(`/customer/saved/${ids.event}`, 'guest', { method: 'PUT' });

    // Booking and pass summaries reveal attendee-only location details to the
    // buyer/approved guest while keeping pending guests and private venues redacted.
    await m.Location.update({ privacy: 'attendees_only', addressLine1: '88 Nightlife Avenue', addressLine2: 'Suite 4', postalCode: '32801' }, { where: { id: ids.location } });
    const buyerBookings = await request('/customer/bookings?page=1&period=upcoming', 'guest');
    const paidEvent = buyerBookings.data.orders.find((order) => order.id === ids.order).event;
    assert.equal(paidEvent.location.addressLine1, '88 Nightlife Avenue');
    const confirmedPass = await request(`/customer/guestlists/${ids.entry}/pass`, 'guest');
    assert.equal(confirmedPass.data.event.location.addressLine1, '88 Nightlife Avenue');
    const pendingRows = await request('/customer/bookings?page=1&period=upcoming', 'pendingGuest');
    const pendingEvent = pendingRows.data.guestlists.find((entry) => entry.status === 'pending').event;
    assert.equal(pendingEvent.location.addressLine1, undefined);
    assert.equal(pendingEvent.location.postalCode, undefined);
    await m.Location.update({ privacy: 'private' }, { where: { id: ids.location } });
    const privatePass = await request(`/customer/guestlists/${ids.entry}/pass`, 'guest');
    assert.equal(privatePass.data.event.location.addressLine1, undefined, 'private location fields stay hidden even from ticketed attendees');

    // Existing guestlist states and party sizes survive a fresh request to the
    // event details API; a new request persists its requested party size.
    const pendingStatus = await request(`/customer/events/${ids.event}/guestlist`, 'pendingGuest');
    assert.equal(pendingStatus.status, 200, JSON.stringify(pendingStatus));
    assert.equal(pendingStatus.data.entry.status, 'pending');
    assert.equal(pendingStatus.data.entry.partySize, 2);
    assert.equal(pendingStatus.data.maxPartySize, 20);
    const maximumParty = await request(`/customer/guestlists/${pendingStatus.data.entry.id}`, 'pendingGuest', { method: 'PATCH', body: { partySize: 20 } });
    assert.equal(maximumParty.status, 200, JSON.stringify(maximumParty));
    assert.equal(maximumParty.data.entry.partySize, 20);
    assert.equal((await request(`/customer/guestlists/${pendingStatus.data.entry.id}`, 'pendingGuest', { method: 'PATCH', body: { partySize: 21 } })).status, 422);
    assert.equal((await request(`/customer/guestlists/${pendingStatus.data.entry.id}`, 'guest', { method: 'PATCH', body: { partySize: 5 } })).status, 404, 'another account cannot edit a guestlist request');
    await request(`/customer/guestlists/${pendingStatus.data.entry.id}`, 'pendingGuest', { method: 'PATCH', body: { partySize: 2 } });
    await m.GuestlistEntry.update({ status: 'rejected' }, { where: { userId: ids.pendingGuest, eventId: ids.event } });
    assert.equal((await request(`/customer/events/${ids.event}/guestlist`, 'pendingGuest')).data.entry.status, 'rejected', 'a declined entry remains visible after reload');
    await m.GuestlistEntry.update({ status: 'pending' }, { where: { userId: ids.pendingGuest, eventId: ids.event } });
    const confirmedStatus = await request(`/customer/events/${ids.event}/guestlist`, 'guest');
    assert.equal(confirmedStatus.data.entry.status, 'confirmed');
    assert.equal(confirmedStatus.data.entry.partySize, 3);
    assert.equal((await request(`/customer/guestlists/${ids.entry}`, 'guest', { method: 'PATCH', body: { partySize: 4 } })).status, 409, 'approved party sizes cannot be silently changed');
    assert.equal((await request(`/customer/guestlists/${ids.entry}`, 'guest', { method: 'DELETE' })).status, 409, 'approved entries cannot be withdrawn through pending controls');
    const newRequest = await request(`/events/${ids.event}/guestlist`, 'outsider', { method: 'POST', body: { partySize: 4 } });
    assert.equal(newRequest.status, 202, JSON.stringify(newRequest));
    assert.equal(newRequest.data.entry.partySize, 4);
    const updatedRequest = await request(`/customer/guestlists/${newRequest.data.entry.id}`, 'outsider', { method: 'PATCH', body: { partySize: 6 } });
    assert.equal(updatedRequest.status, 200, JSON.stringify(updatedRequest));
    assert.equal(updatedRequest.data.entry.partySize, 6);
    const persistedStatus = await request(`/customer/events/${ids.event}/guestlist`, 'outsider');
    assert.equal(persistedStatus.data.entry.status, 'pending');
    assert.equal(persistedStatus.data.entry.partySize, 6);
    const withdrawn = await request(`/customer/guestlists/${newRequest.data.entry.id}`, 'outsider', { method: 'DELETE' });
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn));
    assert.equal(withdrawn.data.withdrawn, true);
    assert.equal(await m.AuditLog.count({ where: { entityType: 'GuestlistEntry', entityId: newRequest.data.entry.id, action: 'guestlist.withdrawn', actorUserId: ids.outsider } }), 1);
    assert.equal((await request(`/customer/events/${ids.event}/guestlist`, 'outsider')).data.entry, null);
    assert.equal((await request(`/customer/events/${ids.event}/guestlist`, null)).status, 401);

    await m.Organization.update({ lifecycleState: 'suspended', status: 'suspended' }, { where: { id: ids.org } });
    assert.equal((await request(`/customer/events/${ids.event}/guestlist`, 'pendingGuest')).data.requestsOpen, false);
    assert.equal((await request(`/customer/guestlists/${pendingStatus.data.entry.id}`, 'pendingGuest', { method: 'PATCH', body: { partySize: 3 } })).status, 403);
    await m.Organization.update({ lifecycleState: 'active', status: 'active' }, { where: { id: ids.org } });
    await m.Event.update({ lifecycleState: 'suspended' }, { where: { id: ids.event } });
    const suspendedStatus = await request(`/customer/events/${ids.event}/guestlist`, 'pendingGuest');
    assert.equal(suspendedStatus.data.requestsOpen, false);
    assert.equal((await request(`/customer/guestlists/${pendingStatus.data.entry.id}`, 'pendingGuest', { method: 'PATCH', body: { partySize: 3 } })).status, 403);
    await m.Event.update({ lifecycleState: 'active', endsAt: new Date(Date.now() - 60 * 60 * 1000) }, { where: { id: ids.event } });
    assert.equal((await request(`/customer/events/${ids.event}/guestlist`, 'pendingGuest')).data.requestsOpen, false);
    assert.equal((await request(`/customer/guestlists/${pendingStatus.data.entry.id}`, 'pendingGuest', { method: 'DELETE' })).error.code, 'GUESTLIST_CLOSED');
    await m.Event.update({ endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000) }, { where: { id: ids.event } });

    // Notification pages are bounded and user-scoped, with unread count kept
    // separate from page length.
    const ownRows = Array.from({ length: 23 }, (_, index) => ({ userId: ids.guest, eventId: ids.event, kind: 'qa', title: `QA notification ${index}`, message: 'fixture', readAt: index < 5 ? new Date() : null }));
    const otherRows = Array.from({ length: 3 }, (_, index) => ({ userId: ids.outsider, eventId: ids.event, kind: 'qa', title: `Other notification ${index}`, message: 'fixture' }));
    const createdNotifications = await m.Notification.bulkCreate([...ownRows, ...otherRows], { returning: true });
    notificationIds.push(...createdNotifications.map((row) => row.id));
    const firstNotifications = await request('/notifications?page=1&pageSize=7', 'guest');
    const secondNotifications = await request('/notifications?page=2&pageSize=7', 'guest');
    assert.equal(firstNotifications.status, 200, JSON.stringify(firstNotifications));
    assert.equal(firstNotifications.data.items.length, 7);
    assert.equal(firstNotifications.data.total, 23);
    assert.equal(firstNotifications.data.unreadCount, 18);
    assert.equal(firstNotifications.data.hasMore, true);
    assert.equal(new Set([...firstNotifications.data.items, ...secondNotifications.data.items].map((item) => item.id)).size, 14);
    assert.ok([...firstNotifications.data.items, ...secondNotifications.data.items].every((item) => item.userId === undefined || item.userId === ids.guest));

    // Connection rows use a bounded numbered page; generating more than one
    // page guards against loading all relationship events into the customer UI.
    const attributed = await m.EventAffiliate.findOne({ where: { eventId: ids.event, userId: ids.promoter } });
    await m.Order.update({ eventAffiliateId: attributed.id }, { where: { id: ids.order } });
    const connectionEventRows = Array.from({ length: 11 }, (_, index) => {
      const startsAt = new Date(Date.now() + (24 + index) * 60 * 60 * 1000);
      return { id: randomUUID(), creatorUserId: ids.owner, organizationId: ids.org, title: `Connection page ${index}`, slug: `connection-page-${index}-${randomUUID()}`, category: 'nightlife', status: 'published', lifecycleState: 'active', isDiscoverable: true, startsAt, endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000) };
    });
    const savedConnectionEvents = await m.Event.bulkCreate(connectionEventRows, { returning: true });
    extraEvents.push(...savedConnectionEvents.map((row) => row.id));
    const affiliateRows = await m.EventAffiliate.bulkCreate(savedConnectionEvents.map((event, index) => ({ eventId: event.id, userId: ids.promoter, code: `QA${index}-${randomUUID().slice(0, 8)}`, status: 'active', guestlistAllocation: 0 })), { returning: true });
    extraAffiliates.push(...affiliateRows.map((row) => row.id));

    // Exercise history and event-picker paging with enough connected people to
    // place eligible results after the first page, plus a feed total over 100.
    const referrers = Array.from({ length: 22 }, (_, index) => ({
      id: randomUUID(), email: `connection-referrer-${index}-${ids.org}@qa.nitewide.test`,
      displayName: `QA Referrer ${String(index + 1).padStart(2, '0')}`, isActive: true,
    }));
    await m.User.bulkCreate(referrers);
    extraUsers.push(...referrers.map((user) => user.id));
    const pickLocations = await m.Location.bulkCreate(Array.from({ length: 5 }, (_, index) => ({
      name: `Paged Picker Venue ${index + 1}`, city: index === 2 ? 'Filtered Picker City' : 'Paged Picker City',
      region: 'FL', countryCode: 'US', timezone: 'America/New_York', privacy: 'public', lifecycleState: 'active',
    })), { returning: true });
    extraLocations.push(...pickLocations.map((location) => location.id));
    const pickerEvents = await m.Event.bulkCreate(Array.from({ length: 5 }, (_, index) => {
      const startsAt = new Date(Date.now() + (72 + index) * 60 * 60 * 1000);
      return { id: randomUUID(), creatorUserId: ids.owner, organizationId: ids.org, locationId: pickLocations[index].id,
        title: index === 2 ? 'Needle Picker Event' : `Paged Picker Event ${index + 1}`, slug: `paged-picker-${index}-${randomUUID()}`,
        summary: 'connection paging fixture', category: 'nightlife', status: 'published', lifecycleState: 'active', isDiscoverable: true,
        startsAt, endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000) };
    }), { returning: true });
    extraEvents.push(...pickerEvents.map((event) => event.id));
    // The seed already creates an event-affiliate row for ids.promoter on
    // ids.event. Add only the new users here to avoid violating the unique
    // (eventId, userId) assignment constraint.
    const referrerIds = referrers.map((user) => user.id);
    const purchaseAffiliates = await m.EventAffiliate.bulkCreate(referrerIds.map((userId, index) => ({
      eventId: ids.event, userId, code: `HISTORY${index}-${randomUUID().slice(0, 8)}`, status: 'active', guestlistAllocation: 0,
    })), { returning: true });
    extraAffiliates.push(...purchaseAffiliates.map((affiliate) => affiliate.id));
    const historyOrders = await m.Order.bulkCreate(purchaseAffiliates.map((affiliate) => ({
      buyerUserId: ids.guest, eventId: ids.event, status: 'paid', paidAt: new Date(),
      eventAffiliateId: affiliate.id, idempotencyKey: `connection-history-${randomUUID()}`,
    })), { returning: true });
    extraOrderIds.push(...historyOrders.map((order) => order.id));
    const pickerReferrerIds = [ids.promoter, ...referrerIds];
    const pickerAffiliates = await m.EventAffiliate.bulkCreate(pickerEvents.flatMap((event) => pickerReferrerIds.map((userId, index) => ({
      eventId: event.id, userId, code: `PICK${event.id.slice(0, 5)}-${index}-${randomUUID().slice(0, 6)}`, status: 'active', guestlistAllocation: 0,
    }))), { returning: true });
    extraAffiliates.push(...pickerAffiliates.map((affiliate) => affiliate.id));

    const firstPeople = await request('/customer/connections/people?page=1&pageSize=10', 'guest');
    const secondPeople = await request('/customer/connections/people?page=2&pageSize=10', 'guest');
    assert.equal(firstPeople.data.total, 23, 'history includes the existing promoter and 22 additional connected people');
    assert.equal(firstPeople.data.people.length, 10);
    assert.equal(secondPeople.data.people.length, 10);
    assert.equal(firstPeople.data.hasMore, true);
    assert.notEqual(firstPeople.data.people[0].id, secondPeople.data.people[0].id);
    const searchedPeople = await request('/customer/connections/people?search=Referrer%2022&page=1&pageSize=10', 'guest');
    assert.equal(searchedPeople.data.total, 1);
    assert.match(searchedPeople.data.people[0].name, /Referrer 22/);

    const firstPickerPage = await request(`/customer/connections?eventId=${pickerEvents[0].id}&page=1&pageSize=9`, 'guest');
    const thirdPickerPage = await request(`/customer/connections?eventId=${pickerEvents[0].id}&page=3&pageSize=9`, 'guest');
    assert.equal(firstPickerPage.data.total, 23, 'event picker total is scoped to that event');
    assert.equal(firstPickerPage.data.items.length, 9);
    assert.equal(thirdPickerPage.data.items.length, 5, 'the picker can reach eligible people after its first two pages');
    assert.ok(thirdPickerPage.data.items.every((item) => item.referrer?.id));

    const firstFeedPage = await request('/customer/connections?page=1&pageSize=30', 'guest');
    const secondFeedPage = await request('/customer/connections?page=2&pageSize=30', 'guest');
    assert.ok(firstFeedPage.data.total > 100, `fixture needs more than 100 eligible event/person rows; received ${firstFeedPage.data.total}`);
    assert.equal(firstFeedPage.data.items.length, 30);
    assert.equal(secondFeedPage.data.items.length, 30);
    assert.equal(firstFeedPage.data.hasMore, true);
    const filteredFeed = await request(`/customer/connections?city=Filtered%20Picker%20City&query=Needle%20Picker%20Event&personIds=${referrers[0].id}%2C${referrers[1].id}&page=1&pageSize=1`, 'guest');
    assert.equal(filteredFeed.data.total, 2, 'city, text, and people filters are reflected in the paired total before pagination');
    assert.equal(filteredFeed.data.items.length, 1);
    assert.equal(filteredFeed.data.items[0].event.id, pickerEvents[2].id);
    const filteredFeedNext = await request(`/customer/connections?city=Filtered%20Picker%20City&query=Needle%20Picker%20Event&personIds=${referrers[0].id}%2C${referrers[1].id}&page=2&pageSize=1`, 'guest');
    assert.equal(filteredFeedNext.data.total, 2);
    assert.equal(filteredFeedNext.data.items.length, 1);
    const firstConnections = await request('/customer/connections?page=1&pageSize=5', 'guest');
    const nextConnections = await request('/customer/connections?page=2&pageSize=5', 'guest');
    assert.equal(firstConnections.status, 200, JSON.stringify(firstConnections));
    assert.equal(firstConnections.data.items.length, 5);
    assert.ok(firstConnections.data.total >= 11);
    assert.equal(firstConnections.data.hasMore, true);
    const listedIds = [...firstConnections.data.items, ...nextConnections.data.items].map((item) => item.event.id);
    assert.equal(new Set(listedIds).size, listedIds.length, 'numbered relationship pages do not duplicate event/referrer pairs');
    const outsiderConnections = await request('/customer/connections?page=1&pageSize=5', 'outsider');
    assert.equal(outsiderConnections.data.total, 0, 'connection history remains scoped to the customer account');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (notificationIds.length) await m.Notification.destroy({ where: { id: notificationIds } });
    if (extraOrderIds.length) await m.Order.destroy({ where: { id: extraOrderIds } });
    if (extraAffiliates.length) await m.EventAffiliate.destroy({ where: { id: extraAffiliates } });
    if (extraEvents.length) await m.Event.destroy({ where: { id: extraEvents } });
    if (extraLocations.length) await m.Location.destroy({ where: { id: extraLocations } });
    if (extraUsers.length) await m.User.destroy({ where: { id: extraUsers } });
    if (fixture && m.SavedEvent) await m.SavedEvent.destroy({ where: { eventId: fixture.events } });
    if (fixture) await cleanupFixture(m, fixture);
    await sequelize.close();
  }
});
