const { createPasswordRecord } = require('../apps/api/src/services/auth-service');
const { createHash } = require('node:crypto');
const { walletToken, guestlistWalletToken } = require('../apps/api/src/domain/wallet-qr');

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
// Fixed disposable credentials keep the rendered QR matrices reproducible.
// The managed-database guard below prevents these hashes reaching real data.
const qrHash = id => createHash('sha256').update(`nitewide-playwright-pass:${id}`).digest('hex');
const password = 'NitewideDemo!2026';
const accounts = {
  customer: { id: uuid(1), email: 'jordan@playwright.nitewide.test', name: 'Jordan Customer' },
  business: { id: uuid(2), email: 'sam@playwright.nitewide.test', name: 'Sam Rivera' },
  admin: { id: uuid(3), email: 'admin@playwright.nitewide.test', name: 'Nitewide Admin' },
  pending: { id: uuid(4), email: 'pending@playwright.nitewide.test', name: 'Pending Guest' },
  promoter: { id: uuid(5), email: 'promoter@playwright.nitewide.test', name: 'Leo Promoter' },
};
let passwordRecord;
async function seed(models, config) {
  const databaseUrl = require('../apps/api/scripts/test-database.cjs').assertManagedTestDatabase();
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (config.DATABASE_URL !== databaseUrl || models.User.sequelize.getDatabaseName() !== databaseName) {
    throw new Error('Refusing to reset models outside the managed Playwright database.');
  }
  passwordRecord ||= await createPasswordRecord(password);
  const ids = { org: uuid(50), location: uuid(51), event: uuid(100), draft: uuid(150), offering: uuid(200), package: uuid(250), ticket: uuid(600), entry: uuid(700), pending: uuid(701), order: uuid(400), affiliate: uuid(900) };
  // All tables belong to the generated, managed test database. Leave migration
  // metadata alone; no application/demo seed or external flyer fetch is used.
  const tables = Object.values(models).filter(model => typeof model.getTableName === 'function')
    .map(model => models.User.sequelize.getQueryInterface().queryGenerator.quoteTable(model.getTableName()));
  await models.User.sequelize.query(`TRUNCATE ${[...new Set(tables)].join(',')} RESTART IDENTITY CASCADE`);
  await models.User.sequelize.transaction(async transaction => {
    const options = { transaction };
    for (const [role, account] of Object.entries(accounts)) {
      await models.User.create({ id: account.id, displayName: account.name, email: account.email, isActive: true, isInternalAdmin: role === 'admin', emailVerifiedAt: new Date() }, options);
      await models.UserCredential.create({ userId: account.id, ...passwordRecord }, options);
    }
    // Enough independent rows to actually exercise backend pagination.
    for (let index = 0; index < 25; index++) {
      const userId = uuid(1000 + index);
      await models.User.create({ id: userId, displayName: `Team Member ${String(index + 1).padStart(2, '0')}`, email: `team${index}@playwright.nitewide.test` }, options);
    }
    await models.Location.create({ id: ids.location, name: 'Playwright Venue', city: 'Orlando', region: 'FL', countryCode: 'US', addressLine1: '100 Nightlife Lane', postalCode: '32801', timezone: 'America/New_York', privacy: 'public' }, options);
    await models.Organization.create({ id: ids.org, name: 'Playwright Nightlife', slug: 'playwright-nightlife', locationId: ids.location, planTier: 'premium' }, options);
    // Organization's compatibility afterSave hook already creates this link.
    await models.OrganizationVenue.findOrCreate({ where: { organizationId: ids.org, locationId: ids.location }, ...options });
    await models.OrganizationOwner.create({ organizationId: ids.org, userId: accounts.business.id, role: 'admin' }, options);
    await models.OrganizationEmployee.bulkCreate(Array.from({ length: 25 }, (_, i) => ({ organizationId: ids.org, userId: uuid(1000 + i), status: 'active' })), options);
    await models.OrgAffiliate.bulkCreate([{ organizationId: ids.org, userId: accounts.business.id, code: 'PW-SAM', defaultGuestlistAllocation: 10 }, { organizationId: ids.org, userId: accounts.promoter.id, code: 'PW-LEO', defaultGuestlistAllocation: 10, defaultCommissionBps: 500 }], options);
    for (let index = 0; index < 14; index++) {
      const eventId = uuid(100 + index);
      const startsAt = new Date(Date.now() + (2 + index * 6) * 3600000);
      await models.Event.create({ id: eventId, organizationId: ids.org, creatorUserId: accounts.business.id, locationId: ids.location,
        title: index === 0 ? 'Playwright Friday Night' : `Playwright Night ${String(index + 1).padStart(2, '0')}`,
        slug: `playwright-night-${index}`, category: 'nightlife', description: 'Deterministic browser test event.', startsAt, endsAt: new Date(+startsAt + 4 * 3600000), status: 'published', capacity: 100, guestlistCapacity: 60 }, options);
      await models.Offering.create({ id: uuid(200 + index), eventId, name: 'General Admission', kind: 'ticket', priceCents: 2500, quantityTotal: 100, quantitySold: index < 12 ? 1 : 0 }, options);
      if (index < 12) {
        await models.Order.create({ id: uuid(400 + index), eventId, buyerUserId: accounts.customer.id, status: 'paid', subtotalCents: 2500, totalCents: 2800, platformFeeCents: 300,
          paidAt: new Date(), idempotencyKey: `playwright-order-${index}`, pricingPlanSnapshot: { demo: true } }, options);
        await models.OrderItem.create({ id: uuid(500 + index), orderId: uuid(400 + index), offeringId: uuid(200 + index), nameSnapshot: 'General Admission', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 2500, lineTotalCents: 2500 }, options);
        await models.Ticket.create({ id: uuid(600 + index), eventId, orderItemId: uuid(500 + index), holderUserId: accounts.customer.id, status: 'valid', qrTokenHash: qrHash(uuid(600 + index)) }, options);
      }
    }
    await models.Event.create({ id: ids.draft, organizationId: ids.org, creatorUserId: accounts.business.id, locationId: ids.location, title: 'Playwright Draft', slug: 'playwright-draft', status: 'draft', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), guestlistCapacity: 10 }, options);
    await models.Offering.create({ id: ids.package, eventId: ids.event, name: 'VIP Package', kind: 'package', priceCents: 30000, entriesPerUnit: 3, quantityTotal: 10 }, options);
    await models.EventAffiliate.create({ id: ids.affiliate, eventId: ids.event, userId: accounts.promoter.id, code: 'PW-EVENT-LEO', status: 'active', guestlistAllocation: 10, commissionBps: 500, accessScope: 'event' }, options);
    const managerAffiliate = await models.OrgAffiliate.findOne({ where: { organizationId: ids.org, userId: accounts.business.id }, transaction });
    await models.EventAffiliate.create({ id: uuid(901), eventId: ids.event, userId: accounts.business.id, orgAffiliateId: managerAffiliate.id, code: 'PW-EVENT-SAM', status: 'active', guestlistAllocation: 10, commissionBps: 0, accessScope: 'organization' }, options);
    await models.GuestlistEntry.bulkCreate([{ id: ids.entry, eventId: ids.event, userId: accounts.customer.id, status: 'confirmed', partySize: 3, source: 'event', qrTokenHash: qrHash(ids.entry) },
      { id: ids.pending, eventId: ids.event, userId: accounts.pending.id, status: 'pending', partySize: 2, source: 'event' }], options);
    await models.Notification.bulkCreate([{ userId: accounts.customer.id, eventId: ids.event, kind: 'guestlist_approved', title: 'Your guestlist is approved', message: 'Your three places are approved.', metadata: { guestlistEntryId: ids.entry } },
      { userId: accounts.customer.id, eventId: ids.event, kind: 'purchase_confirmed', title: 'Your tickets are confirmed', message: 'General Admission is booked.', metadata: { orderId: ids.order } }], options);
  });
  const ticket = await models.Ticket.findByPk(ids.ticket);
  const entry = await models.GuestlistEntry.findByPk(ids.entry);
  const otherTicket = await models.Ticket.findByPk(uuid(601));
  return { ids, accounts, password, ticketQr: walletToken(ticket, config.QR_TOKEN_SECRET), wrongEventQr: walletToken(otherTicket, config.QR_TOKEN_SECRET), guestlistQr: guestlistWalletToken(entry, config.QR_TOKEN_SECRET) };
}
// Opt-in operator scenario: only the disposable harness uses this. Keeping it
// separate leaves checkout/bookings pagination fixtures unchanged.
async function seedMyEventsScenario(models, config, fixture, { past = false } = {}) {
  const databaseUrl = require('../apps/api/scripts/test-database.cjs').assertManagedTestDatabase();
  if (config.DATABASE_URL !== databaseUrl || models.User.sequelize.getDatabaseName() !== new URL(databaseUrl).pathname.slice(1)) {
    throw new Error('My events scenarios require the managed Playwright database.');
  }
  await models.User.sequelize.transaction(async transaction => {
    await models.Order.update({ eventAffiliateId: fixture.ids.affiliate, affiliateCommissionCents: 125 }, { where: { id: fixture.ids.order }, transaction });
    await models.Order.create({ id: uuid(450), eventId: fixture.ids.event, buyerUserId: accounts.pending.id, status: 'paid', subtotalCents: 4000, totalCents: 4400,
      platformFeeCents: 400, paidAt: new Date(), idempotencyKey: 'my-events-uncredited-order', pricingPlanSnapshot: { demo: true } }, { transaction });
    await models.OrderItem.create({ id: uuid(550), orderId: uuid(450), offeringId: fixture.ids.offering, nameSnapshot: 'General Admission', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 4000, lineTotalCents: 4000 }, { transaction });
    await models.Payment.bulkCreate([
      { orderId: fixture.ids.order, provider: 'demo', providerReference: 'my-events-demo-credited', status: 'succeeded', amountCents: 2800, currency: 'USD', processedAt: new Date() },
      { orderId: uuid(450), provider: 'demo', providerReference: 'my-events-demo-uncredited', status: 'succeeded', amountCents: 4400, currency: 'USD', processedAt: new Date() },
    ], { transaction });
    if (past) await models.Event.update({ startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() - 72000000), status: 'completed' }, { where: { id: fixture.ids.event }, transaction });
  });
  return { ...fixture, scenario: { past, eventSalesCents: 6500, ownSalesCents: 2500, ownCommissionCents: 125 } };
}
module.exports = { seed, seedMyEventsScenario, accounts, password, uuid };
