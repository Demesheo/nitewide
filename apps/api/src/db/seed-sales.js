require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
const { randomUUID } = require('node:crypto');
const { Op } = require('sequelize');
const { getConfig } = require('../config');
const { createSequelize } = require('./sequelize');
const { initModels } = require('./models');
const { createCheckoutService } = require('../services/checkout-service');
const { createPasswordRecord } = require('../services/auth-service');
const { venues, eventDays, packageTemplates, teamCountsForVenue, managerFixture, employeeFixture, demoPassword, recentWeekendDates, slugify } = require('./seed');

async function addDemoSales() {
  const config = getConfig();
  const dbHost = new URL(config.DATABASE_URL).hostname;
  if (config.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(dbHost)) throw new Error('Demo sales refresh requires a local non-production database');
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  try {
    await sequelize.authenticate();
    const customers = await models.User.findAll({ where: { email: { [Op.like]: '%.customer%@nitewide.test' }, isActive: true }, order: [['email', 'ASC']] });
    if (customers.length < 12) throw new Error('Baseline demo customers are missing; run the baseline seed only on an empty development database');
    let eventsAdded = 0; let salesAdded = 0; let employeesAdded = 0; let managersAdded = 0;
    for (const [venueIndex, venue] of venues.entries()) {
      const organization = await models.Organization.findOne({ where: { slug: venue.legacySlug || slugify(venue.name) } });
      if (!organization) continue;
      const staffCode = `${organization.slug}-STAFF`.toUpperCase();
      const legacyManagerAffiliate = await models.OrgAffiliate.findOne({ where: { organizationId: organization.id, code: staffCode } });
      if (legacyManagerAffiliate) {
        if (legacyManagerAffiliate.status === 'active') await legacyManagerAffiliate.update({ status: 'inactive' });
        await models.EventAffiliate.update({ status: 'inactive' }, { where: { orgAffiliateId: legacyManagerAffiliate.id, status: 'active' } });
      }
      const teamCounts = teamCountsForVenue(venueIndex);
      for (let managerIndex = 1; managerIndex < teamCounts.managers; managerIndex += 1) {
        const fixture = managerFixture(venueIndex, managerIndex);
        let managerUser = await models.User.findOne({ where: { email: fixture.email } });
        if (!managerUser) {
          managerUser = await models.User.create(fixture);
          await models.UserCredential.create({ userId: managerUser.id, ...(await createPasswordRecord(demoPassword)) });
          managersAdded += 1;
        }
        await models.OrganizationOwner.findOrCreate({ where: { organizationId: organization.id, userId: managerUser.id }, defaults: { role: 'admin' } });
      }
      for (let employeeIndex = 0; employeeIndex < teamCounts.employees; employeeIndex += 1) {
        const fixture = employeeFixture(venueIndex, employeeIndex);
        let employee = await models.User.findOne({ where: { email: fixture.email } });
        if (!employee) {
          employee = await models.User.create(fixture);
          await models.UserCredential.create({ userId: employee.id, ...(await createPasswordRecord(demoPassword)) });
          employeesAdded += 1;
        }
        await models.OrganizationEmployee.findOrCreate({ where: { organizationId: organization.id, userId: employee.id }, defaults: { status: 'active' } });
      }
      const location = await models.Location.findOne({ where: { name: venue.name } });
      const manager = await models.OrganizationOwner.findOne({ where: { organizationId: organization.id, role: 'admin' } });
      const orgAffiliates = await models.OrgAffiliate.findAll({ where: { organizationId: organization.id, status: 'active', defaultCommissionBps: { [Op.gt]: 0 } }, order: [['createdAt', 'ASC']] });
      if (!location || !manager) continue;
      for (const date of recentWeekendDates()) {
        const dayIndex = [5, 6, 0].indexOf(date.getDay());
        const day = eventDays[dayIndex];
        const dateKey = date.toISOString().slice(0, 10);
        const slug = `${organization.slug}-${day.short.toLowerCase()}-${dateKey}`;
        let event = await models.Event.findOne({ where: { organizationId: organization.id, slug } });
        if (!event) {
          event = await models.Event.create({ organizationId: organization.id, creatorUserId: manager.userId, locationId: location.id,
            title: `${venue.name} ${day.title}`, slug, summary: `${day.label} nightlife at ${venue.name} in the ${venue.metroArea} area.`,
            description: `${venue.description} Demonstration historical event.`, category: 'nightlife', status: 'published',
            startsAt: date, endsAt: new Date(date.getTime() + 4.5 * 3600000), capacity: 500, guestlistCapacity: day.directGuestlistCapacity });
          eventsAdded += 1;
        }
        for (const [index, affiliate] of orgAffiliates.slice(0, 2).entries()) {
          await models.EventAffiliate.findOrCreate({ where: { eventId: event.id, userId: affiliate.userId }, defaults: { orgAffiliateId: affiliate.id,
            code: `${organization.slug}-${day.short}-${dateKey}-P${index + 1}`.toUpperCase(), commissionBps: day.commissionBps + index * 100, guestlistAllocation: day.guestlistAllocation } });
        }
        const baseOfferings = [{ name: 'General Admission', description: 'Single admission credential.', kind: 'ticket', priceCents: 1000, quantityTotal: 350, entriesPerUnit: 1, maxPerOrder: 8 },
          ...packageTemplates.map((item) => ({ ...item, kind: 'package', entriesPerUnit: 4, maxPerOrder: 2 }))];
        for (const [index, item] of baseOfferings.entries()) {
          await models.Offering.findOrCreate({ where: { eventId: event.id, name: item.name }, defaults: { ...item, salesStartAt: new Date(date.getTime() - 30 * 86400000), salesEndAt: new Date(date.getTime() - 3600000), sortOrder: index + 1 } });
        }
      }
      const events = await models.Event.findAll({ where: { organizationId: organization.id, status: 'published', startsAt: { [Op.gte]: new Date(Date.now() - 28 * 86400000) } }, order: [['startsAt', 'ASC']] });
      for (const [eventIndex, event] of events.entries()) {
        const offerings = await models.Offering.findAll({ where: { eventId: event.id, isActive: true } });
        const ga = offerings.find((item) => item.kind === 'ticket');
        if (!ga) continue;
        const byName = new Map(offerings.map((item) => [item.name, item]));
        const now = new Date();
        const isPast = event.startsAt < now;
        const usable = [ga, ga, ga, ...packageTemplates.map((item) => byName.get(item.name))].filter(Boolean);
        const affiliates = await models.EventAffiliate.findAll({ where: { eventId: event.id, status: 'active' }, order: [['createdAt', 'ASC']] });
        for (const [saleIndex, offering] of usable.entries()) {
          const buyer = customers[(venueIndex * 7 + eventIndex * 3 + saleIndex * 2) % customers.length];
          const paidAt = isPast ? new Date(event.startsAt.getTime() - (saleIndex + 2) * 3600000) : new Date(now.getTime() - saleIndex * 3600000);
          if (offering.salesStartAt && paidAt < offering.salesStartAt || offering.salesEndAt && paidAt > offering.salesEndAt) continue;
          const key = `demo-sales-${event.id}-${saleIndex}`;
          if (await models.Order.count({ where: { buyerUserId: buyer.id, idempotencyKey: key } })) continue;
          const affiliateCode = [2, 5].includes(saleIndex) ? undefined : affiliates[saleIndex % affiliates.length]?.code;
          const checkout = createCheckoutService({ sequelize, models, now: () => paidAt });
          await checkout({ buyerUserId: buyer.id, eventId: event.id, idempotencyKey: key, affiliateCode,
            items: [{ offeringId: offering.id, quantity: offering.kind === 'ticket' ? 1 + ((venueIndex + eventIndex + saleIndex) % 4) : 1 }],
            payment: { provider: 'seed', reference: `demo-sale-${randomUUID()}`, status: 'succeeded' } });
          salesAdded += 1;
        }
      }
    }
    console.log(`Added ${managersAdded} demo managers, ${employeesAdded} demo employees, ${eventsAdded} historical events, and ${salesAdded} paid demo orders; existing records were preserved.`);
  } finally { await sequelize.close(); }
}
if (require.main === module) addDemoSales().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { addDemoSales };
