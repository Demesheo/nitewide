const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createQrToken } = require('../src/domain/qr');
const { createPasswordRecord } = require('../src/services/auth-service');
async function createFixture(m, config, { orderValues = {}, itemValues = {}, referred = false } = {}) {
  assert.notEqual(config.NODE_ENV, 'production');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname), 'Local test database only');
  const ids = Object.fromEntries(['owner', 'manager', 'employee', 'promoter', 'admin', 'independentCreator', 'guest', 'pendingGuest', 'outsider', 'org', 'location', 'event', 'otherEvent', 'future', 'expired', 'draft', 'order', 'item', 'ticket', 'manualTicket', 'voidTicket', 'entry'].map((key) => [key, randomUUID()]));
  const users = ['owner', 'manager', 'employee', 'promoter', 'admin', 'independentCreator', 'guest', 'pendingGuest', 'outsider'].map((key) => ids[key]);
  const events = ['event', 'otherEvent', 'future', 'expired', 'draft'].map((key) => ids[key]);
  await m.Event.sequelize.transaction(async (transaction) => {
    const options = { transaction };
    for (const key of ['owner', 'manager', 'employee', 'promoter', 'admin', 'independentCreator', 'guest', 'pendingGuest', 'outsider']) {
      await m.User.create({ id: ids[key], email: `${key}.${ids.org}@admissions.nitewide.test`, displayName: `Admissions QA ${key}`, isActive: true, isInternalAdmin: key === 'admin', independentCreator: key === 'independentCreator' }, options);
      await m.UserCredential.create({ userId: ids[key], ...await createPasswordRecord('NitewideDemo!2026') }, options);
    }
    await m.Organization.create({ id: ids.org, name: 'Admissions QA', slug: `admissions-${ids.org}` }, options);
    await m.Location.create({ id: ids.location, name: 'Admissions QA Venue', city: 'Test City', timezone: 'America/New_York', lifecycleState: 'active' }, options);
    await m.OrganizationOwner.bulkCreate([{ organizationId: ids.org, userId: ids.owner, role: 'owner' }, { organizationId: ids.org, userId: ids.manager, role: 'admin' }], options);
    await m.OrganizationEmployee.create({ organizationId: ids.org, userId: ids.employee, status: 'active' }, options);
    for (const key of ['event', 'otherEvent', 'future', 'expired', 'draft']) {
      const offset = key === 'future' ? 48 : key === 'expired' ? -72 : 1;
      await m.Event.create({ id: ids[key], organizationId: ids.org, creatorUserId: ids.owner, locationId: key === 'event' ? ids.location : null, title: key === 'event' ? 'Admissions QA Night' : `Admissions QA ${key}`, slug: `admissions-${ids[key]}`, status: key === 'draft' ? 'draft' : 'published', startsAt: new Date(Date.now() + offset * 3600000), endsAt: new Date(Date.now() + (offset + 4) * 3600000), guestlistCapacity: 10, isDiscoverable: false }, options);
    }
    const affiliate = await m.EventAffiliate.create({ eventId: ids.event, userId: ids.promoter, code: `QA-${ids.org}`, status: 'active', guestlistAllocation: 5 }, options);
    const offering = await m.Offering.create({ eventId: ids.event, name: 'VIP · 2 admissions', kind: 'package', priceCents: 30000, entriesPerUnit: 2, inventoryMode: 'unlimited' }, options);
    await m.Order.create({ id: ids.order, eventId: ids.event, buyerUserId: ids.guest, status: 'paid', subtotalCents: 30000, totalCents: 32200, platformFeeCents: 2200, paidAt: new Date(), idempotencyKey: ids.order,
      ...orderValues, ...(referred ? { eventAffiliateId: affiliate.id } : {}) }, options);
    await m.OrderItem.create({ id: ids.item, orderId: ids.order, offeringId: offering.id, nameSnapshot: offering.name, kindSnapshot: 'package', quantity: 1, entriesPerUnitSnapshot: 2, unitPriceCents: 30000, lineTotalCents: 30000, ...itemValues }, options);
    for (const key of ['ticket', 'manualTicket', 'voidTicket']) await m.Ticket.create({ id: ids[key], eventId: ids.event, orderItemId: ids.item, holderUserId: ids.guest, status: key === 'voidTicket' ? 'void' : 'valid', qrTokenHash: createQrToken().hash }, options);
    await m.GuestlistEntry.create({ id: ids.entry, eventId: ids.event, userId: ids.guest, source: 'event', partySize: 3, status: 'confirmed', qrTokenHash: createQrToken().hash }, options);
    await m.GuestlistEntry.create({ eventId: ids.event, userId: ids.pendingGuest, source: 'event', partySize: 2, status: 'pending' }, options);
  });
  return { ids, users, events };
}
async function cleanupFixture(m, fixture) {
  const { ids, users, events } = fixture;
  await m.Event.sequelize.transaction(async (transaction) => {
    const options = { transaction };
    await m.CheckIn.destroy({ where: { eventId: events }, ...options });
    await m.Ticket.destroy({ where: { eventId: events }, ...options });
    await m.OrderItem.destroy({ where: { orderId: ids.order }, ...options });
    await m.Order.destroy({ where: { id: ids.order }, ...options });
    await m.GuestlistEntry.destroy({ where: { eventId: events }, ...options });
    await m.EventAffiliate.destroy({ where: { eventId: events }, ...options });
    await m.Offering.destroy({ where: { eventId: events }, ...options });
    await m.Event.destroy({ where: { id: events }, ...options });
    await m.OrganizationEmployee.destroy({ where: { organizationId: ids.org }, ...options });
    await m.OrganizationOwner.destroy({ where: { organizationId: ids.org }, ...options });
    await m.OrganizationVenue.destroy({ where: { organizationId: ids.org }, ...options });
    await m.Organization.destroy({ where: { id: ids.org }, ...options });
    await m.UserCredential.destroy({ where: { userId: users }, ...options });
    await m.User.destroy({ where: { id: users }, ...options });
  });
}
module.exports = { createFixture, cleanupFixture };
