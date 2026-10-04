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
// Keep the original dataset for callers that have not selected a recipe. Scale
// journeys opt in explicitly, so changing ordinary setup cannot weaken them.
const commerce = { roles: ['customer', 'business', 'pending', 'promoter'], organization: true, events: 1, orders: 1, team: 0, draft: true, affiliates: true, guestlist: true, notifications: true };
const recipes = Object.freeze(Object.fromEntries(Object.entries({
  legacy: { ...commerce, roles: Object.keys(accounts), events: 14, orders: 12, team: 25 },
  'customer-auth': { roles: ['customer'] },
  'admin-auth': { roles: ['admin'] },
  'admin-access': { roles: ['customer', 'admin'] },
  'business-auth': { roles: ['business'], organization: true },
  'business-access': { roles: ['customer', 'business', 'admin', 'promoter'], organization: true, events: 1, affiliates: true },
  'business-workspaces': { ...commerce, orders: 0, draft: false, guestlist: false, notifications: false, workspaceScopes: true },
  commerce,
  admissions: { ...commerce, events: 2, orders: 2, draft: false },
  'bookings-pagination': { ...commerce, events: 14, orders: 12 },
  'team-pagination': { ...commerce, team: 25 },
  'reports-export': { ...commerce, events: 14, orders: 12 },
  'events-pagination': { ...commerce, events: 14 },
  operator: { ...commerce, credited: true, operator: true },
}).map(([name, recipe]) => [name, Object.freeze({ events: 0, orders: 0, team: 0, ...recipe, roles: Object.freeze(recipe.roles) })])));
function getRecipe(name = 'legacy') {
  if (typeof name !== 'string' || !Object.hasOwn(recipes, name)) throw new Error('Unknown managed browser fixture recipe.');
  return recipes[name];
}
let passwordRecord;
async function seed(models, config, { credited = false, recipe: recipeName = 'legacy' } = {}) {
  const recipe = getRecipe(recipeName);
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
    for (const role of recipe.roles) {
      const account = accounts[role];
      await models.User.create({ id: account.id, displayName: account.name, email: account.email, isActive: true, isInternalAdmin: role === 'admin', emailVerifiedAt: new Date() }, options);
      await models.UserCredential.create({ userId: account.id, ...passwordRecord }, options);
    }
    // Enough independent rows to actually exercise backend pagination.
    for (let index = 0; index < recipe.team; index++) {
      const userId = uuid(1000 + index);
      await models.User.create({ id: userId, displayName: `Team Member ${String(index + 1).padStart(2, '0')}`, email: `team${index}@playwright.nitewide.test` }, options);
    }
    if (recipe.organization) {
      await models.Location.create({ id: ids.location, name: 'Playwright Venue', city: 'Orlando', region: 'FL', countryCode: 'US', addressLine1: '100 Nightlife Lane', postalCode: '32801', timezone: 'America/New_York', privacy: 'public' }, options);
      await models.Organization.create({ id: ids.org, name: 'Playwright Nightlife', slug: 'playwright-nightlife', locationId: ids.location, planTier: 'premium' }, options);
      // Organization's compatibility afterSave hook already creates this link.
      await models.OrganizationVenue.findOrCreate({ where: { organizationId: ids.org, locationId: ids.location }, ...options });
      await models.OrganizationOwner.create({ organizationId: ids.org, userId: accounts.business.id, role: recipe.workspaceScopes ? 'owner' : 'admin' }, options);
      if (recipe.team) await models.OrganizationEmployee.bulkCreate(Array.from({ length: recipe.team }, (_, i) => ({ organizationId: ids.org, userId: uuid(1000 + i), status: 'active' })), options);
      if (recipe.affiliates) await models.OrgAffiliate.bulkCreate([{ organizationId: ids.org, userId: accounts.business.id, code: 'PW-SAM', defaultGuestlistAllocation: 10 }, { organizationId: ids.org, userId: accounts.promoter.id, code: 'PW-LEO', defaultGuestlistAllocation: 10, defaultCommissionBps: 500 }], options);
      if (recipe.workspaceScopes) {
        for (const [index, name, role] of [[1, 'Managed Nights', 'admin'], [2, 'Promoter Nights', 'affiliate'], [3, 'Owner Nights', 'owner']]) {
          const organizationId = uuid(50 + index * 10), eventId = uuid(800 + index);
          ids[`organization${index}`] = organizationId; ids[`workspaceEvent${index}`] = eventId;
          await models.Organization.create({ id: organizationId, name, slug: `playwright-workspace-${index}` }, options);
          if (role === 'affiliate') await models.OrgAffiliate.create({ organizationId, userId: accounts.business.id, code: `PW-SCOPE-${index}`, status: 'active' }, options);
          else await models.OrganizationOwner.create({ organizationId, userId: accounts.business.id, role }, options);
          await models.Event.create({ id: eventId, organizationId, creatorUserId: accounts.business.id, title: `${name} Event`, slug: `playwright-workspace-event-${index}`,
            status: 'published', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 18000000), guestlistCapacity: 10 }, options);
        }
      }
    }
    for (let index = 0; index < recipe.events; index++) {
      const eventId = uuid(100 + index);
      const startsAt = new Date(Date.now() + (2 + index * 6) * 3600000);
      await models.Event.create({ id: eventId, organizationId: ids.org, creatorUserId: accounts.business.id, locationId: ids.location,
        title: index === 0 ? 'Playwright Friday Night' : `Playwright Night ${String(index + 1).padStart(2, '0')}`,
        slug: `playwright-night-${index}`, category: 'nightlife', description: 'Deterministic browser test event.', startsAt, endsAt: new Date(+startsAt + 4 * 3600000), status: 'published', capacity: 100, guestlistCapacity: 60 }, options);
      await models.Offering.create({ id: uuid(200 + index), eventId, name: 'General Admission', kind: 'ticket', priceCents: 2500, quantityTotal: 100, quantitySold: index < recipe.orders ? 1 : 0 }, options);
      if (index === 0 && recipe.affiliates) await models.EventAffiliate.create({ id: ids.affiliate, eventId, userId: accounts.promoter.id, code: 'PW-EVENT-LEO', status: 'active', guestlistAllocation: 10, commissionBps: 500, accessScope: 'event' }, options);
      if (index < recipe.orders) {
        const attribution = (credited || recipe.credited) && index === 0 ? { eventAffiliateId: ids.affiliate, affiliateCommissionCents: 125 } : {};
        await models.Order.create({ id: uuid(400 + index), eventId, buyerUserId: accounts.customer.id, status: 'paid', subtotalCents: 2500, totalCents: 2800, platformFeeCents: 300,
          ...attribution, paidAt: new Date(), idempotencyKey: `playwright-order-${index}`, pricingPlanSnapshot: { demo: true } }, options);
        await models.OrderItem.create({ id: uuid(500 + index), orderId: uuid(400 + index), offeringId: uuid(200 + index), nameSnapshot: 'General Admission', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 2500, lineTotalCents: 2500 }, options);
        await models.Ticket.create({ id: uuid(600 + index), eventId, orderItemId: uuid(500 + index), holderUserId: accounts.customer.id, status: 'valid', qrTokenHash: qrHash(uuid(600 + index)) }, options);
      }
    }
    if (recipe.draft) await models.Event.create({ id: ids.draft, organizationId: ids.org, creatorUserId: accounts.business.id, locationId: ids.location, title: 'Playwright Draft', slug: 'playwright-draft', status: 'draft', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), guestlistCapacity: 10 }, options);
    if (recipe.events) await models.Offering.create({ id: ids.package, eventId: ids.event, name: 'VIP Package', kind: 'package', priceCents: 30000, entriesPerUnit: 3, quantityTotal: 10 }, options);
    if (recipe.events && recipe.affiliates) {
      const managerAffiliate = await models.OrgAffiliate.findOne({ where: { organizationId: ids.org, userId: accounts.business.id }, transaction });
      await models.EventAffiliate.create({ id: uuid(901), eventId: ids.event, userId: accounts.business.id, orgAffiliateId: managerAffiliate.id, code: 'PW-EVENT-SAM', status: 'active', guestlistAllocation: 10, commissionBps: 0, accessScope: 'organization' }, options);
    }
    if (recipe.guestlist) await models.GuestlistEntry.bulkCreate([{ id: ids.entry, eventId: ids.event, userId: accounts.customer.id, status: 'confirmed', partySize: 3, source: 'event', qrTokenHash: qrHash(ids.entry) },
      { id: ids.pending, eventId: ids.event, userId: accounts.pending.id, status: 'pending', partySize: 2, source: 'event' }], options);
    if (recipe.notifications) await models.Notification.bulkCreate([{ userId: accounts.customer.id, eventId: ids.event, kind: 'guestlist_approved', title: 'Your guestlist is approved', message: 'Your three places are approved.', metadata: { guestlistEntryId: ids.entry } },
      { userId: accounts.customer.id, eventId: ids.event, kind: 'purchase_confirmed', title: 'Your tickets are confirmed', message: 'General Admission is booked.', metadata: { orderId: ids.order } }], options);
    if (recipe.operator) await seedOperatorPayments(models, ids, options);
  });
  const fixture = { ids, accounts: Object.fromEntries(recipe.roles.map(role => [role, accounts[role]])), password, recipe: recipeName };
  if (recipe.orders) fixture.ticketQr = walletToken(await models.Ticket.findByPk(ids.ticket), config.QR_TOKEN_SECRET);
  if (recipe.orders > 1) fixture.wrongEventQr = walletToken(await models.Ticket.findByPk(uuid(601)), config.QR_TOKEN_SECRET);
  if (recipe.guestlist) fixture.guestlistQr = guestlistWalletToken(await models.GuestlistEntry.findByPk(ids.entry), config.QR_TOKEN_SECRET);
  if (recipe.operator) fixture.scenario = operatorScenario(false);
  return fixture;
}
const operatorScenario = past => ({ past, eventSalesCents: 6500, ownSalesCents: 2500, ownCommissionCents: 125 });
async function seedOperatorPayments(models, ids, options) {
  await models.Order.create({ id: uuid(450), eventId: ids.event, buyerUserId: accounts.pending.id, status: 'paid', subtotalCents: 4000, totalCents: 4400,
    platformFeeCents: 400, paidAt: new Date(), idempotencyKey: 'my-events-uncredited-order', pricingPlanSnapshot: { demo: true } }, options);
  await models.OrderItem.create({ id: uuid(550), orderId: uuid(450), offeringId: ids.offering, nameSnapshot: 'General Admission', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 4000, lineTotalCents: 4000 }, options);
  await models.Payment.bulkCreate([
    { orderId: ids.order, provider: 'demo', providerReference: 'my-events-demo-credited', status: 'succeeded', amountCents: 2800, currency: 'USD', processedAt: new Date() },
    { orderId: uuid(450), provider: 'demo', providerReference: 'my-events-demo-uncredited', status: 'succeeded', amountCents: 4400, currency: 'USD', processedAt: new Date() },
  ], options);
}
// Opt-in operator scenario: only the disposable harness uses this. Keeping it
// separate leaves checkout/bookings pagination fixtures unchanged.
async function seedMyEventsScenario(models, config, fixture, { past = false } = {}) {
  const databaseUrl = require('../apps/api/scripts/test-database.cjs').assertManagedTestDatabase();
  if (config.DATABASE_URL !== databaseUrl || models.User.sequelize.getDatabaseName() !== new URL(databaseUrl).pathname.slice(1)) {
    throw new Error('My events scenarios require the managed Playwright database.');
  }
  // Attribution is set before the payment becomes immutable, never rewritten.
  if (!fixture.scenario) fixture = await seed(models, config, { credited: true, recipe: fixture.recipe || 'legacy' });
  await models.User.sequelize.transaction(async transaction => {
    if (!fixture.scenario) await seedOperatorPayments(models, fixture.ids, { transaction });
    if (past) await models.Event.update({ startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() - 72000000), status: 'completed' }, { where: { id: fixture.ids.event }, transaction });
  });
  return { ...fixture, scenario: operatorScenario(past) };
}
module.exports = { seed, seedMyEventsScenario, getRecipe, recipes, accounts, password, uuid };
