require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
const { getConfig } = require('../config'); const { createSequelize } = require('./sequelize'); const { initModels } = require('./models');
const { createCheckoutService } = require('../services/checkout-service'); const { createGuestlistService } = require('../services/guestlist-service'); const { createCheckInService } = require('../services/checkin-service');

const ids = {
  admin: '10000000-0000-4000-8000-000000000001', owner: '10000000-0000-4000-8000-000000000002', promoter: '10000000-0000-4000-8000-000000000003', customer: '10000000-0000-4000-8000-000000000004', creator: '10000000-0000-4000-8000-000000000005',
  org: '20000000-0000-4000-8000-000000000001', location: '30000000-0000-4000-8000-000000000001', event: '40000000-0000-4000-8000-000000000001', independentEvent: '40000000-0000-4000-8000-000000000002',
  ga: '50000000-0000-4000-8000-000000000001', vip: '50000000-0000-4000-8000-000000000002', orgAffiliate: '60000000-0000-4000-8000-000000000001', eventAffiliate: '70000000-0000-4000-8000-000000000001',
};

async function seed() {
  const config = getConfig(); if (config.NODE_ENV === 'production' && !process.argv.includes('--allow-production')) throw new Error('Refusing to seed production without --allow-production');
  const sequelize = createSequelize(config); const models = initModels(sequelize); await sequelize.authenticate(); await sequelize.truncate({ cascade: true });
  const startsAt = new Date(Date.now() + 14 * 86_400_000); const endsAt = new Date(startsAt.getTime() + 5 * 3_600_000);
  await models.User.bulkCreate([
    { id: ids.admin, email: 'admin@nitewide.test', displayName: 'Nitewide Admin', isInternalAdmin: true },
    { id: ids.owner, email: 'maya@nitewide.test', displayName: 'Maya Owner', marketingConsentAt: new Date() },
    { id: ids.promoter, email: 'leo@nitewide.test', displayName: 'Leo Promoter' },
    { id: ids.customer, email: 'jordan@nitewide.test', displayName: 'Jordan Customer', marketingConsentAt: new Date() },
    { id: ids.creator, email: 'sam@nitewide.test', displayName: 'Sam Independent Creator' },
  ]);
  await models.Organization.create({ id: ids.org, name: 'Northstar Collective', slug: 'northstar-collective', description: 'Independent event and hospitality collective.', planTier: 'gold' });
  await models.OrganizationOwner.create({ organizationId: ids.org, userId: ids.owner, role: 'owner' });
  await models.Location.create({ id: ids.location, name: 'Harbor Hall', addressLine1: '41 River Street', city: 'Brooklyn', region: 'NY', postalCode: '11201', countryCode: 'US', timezone: 'America/New_York', latitude: 40.7021, longitude: -73.9887, geo: { type: 'Point', coordinates: [-73.9887, 40.7021] }, privacy: 'public' });
  await models.Event.bulkCreate([
    { id: ids.event, creatorUserId: ids.owner, organizationId: ids.org, locationId: ids.location, title: 'Afterglow', slug: 'afterglow', summary: 'A late-night music and visual art experience.', category: 'nightlife', status: 'published', startsAt, endsAt, capacity: 550, guestlistCapacity: 60 },
    { id: ids.independentEvent, creatorUserId: ids.creator, title: 'Rooftop Sessions', slug: 'rooftop-sessions', summary: 'An independently produced live session.', category: 'concert', status: 'published', startsAt: new Date(startsAt.getTime() + 7 * 86_400_000), endsAt: new Date(endsAt.getTime() + 7 * 86_400_000), capacity: 120, guestlistCapacity: 12 },
  ]);
  await models.OrgAffiliate.create({ id: ids.orgAffiliate, organizationId: ids.org, userId: ids.promoter, code: 'LEO-NORTHSTAR', defaultCommissionBps: 800, defaultGuestlistAllocation: 8 });
  await models.EventAffiliate.create({ id: ids.eventAffiliate, eventId: ids.event, userId: ids.promoter, orgAffiliateId: ids.orgAffiliate, code: 'LEO-AFTERGLOW', commissionBps: 1000, guestlistAllocation: 12 });
  await models.Offering.bulkCreate([
    { id: ids.ga, eventId: ids.event, name: 'General Admission', description: 'Entry before midnight.', kind: 'ticket', priceCents: 2500, quantityTotal: 400, entriesPerUnit: 1, maxPerOrder: 8, sortOrder: 1 },
    { id: ids.vip, eventId: ids.event, name: 'VIP Table Package', description: 'Reserved table and four admission credentials.', kind: 'package', priceCents: 45000, quantityTotal: 18, entriesPerUnit: 4, maxPerOrder: 2, sortOrder: 2 },
  ]);
  const checkout = createCheckoutService({ sequelize, models });
  const purchase = await checkout({ buyerUserId: ids.customer, eventId: ids.event, idempotencyKey: 'seed-afterglow-order-001', affiliateCode: 'LEO-AFTERGLOW', items: [{ offeringId: ids.ga, quantity: 2 }], payment: { provider: 'seed', reference: 'seed-payment-001', status: 'succeeded' } });
  const joinGuestlist = createGuestlistService({ sequelize, models }); const guest = await joinGuestlist({ userId: ids.creator, eventId: ids.event, partySize: 2, affiliateCode: 'LEO-AFTERGLOW' });
  const checkIn = createCheckInService({ sequelize, models }); await checkIn({ eventId: ids.event, qrToken: purchase.credentials[0].qrToken, checkedInByUserId: ids.owner });
  console.log('Seed complete. Development identities:', ids); console.log('Sample guestlist QR token:', guest.qrToken); await sequelize.close();
}
seed().catch((error) => { console.error(error); process.exitCode = 1; });

