require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
const { randomUUID } = require('node:crypto');
const { getConfig } = require('../config');
const { createSequelize } = require('./sequelize');
const { initModels } = require('./models');
const { createCheckoutService } = require('../services/checkout-service');
const { createGuestlistService } = require('../services/guestlist-service');
const { createPasswordRecord } = require('../services/auth-service');

const demoPassword = 'NitewideDemo!2026';

const ids = {
  admin: '10000000-0000-4000-8000-000000000001', owner: '10000000-0000-4000-8000-000000000002',
  promoter: '10000000-0000-4000-8000-000000000003', customer: '10000000-0000-4000-8000-000000000004',
  employee: '10000000-0000-4000-8000-000000000005', organization: '20000000-0000-4000-8000-000000000001',
  location: '30000000-0000-4000-8000-000000000001', event: '40000000-0000-4000-8000-000000000001',
  generalAdmission: '50000000-0000-4000-8000-000000000001', regularPackage: '50000000-0000-4000-8000-000000000002',
  orgAffiliate: '60000000-0000-4000-8000-000000000001', eventAffiliate: '70000000-0000-4000-8000-000000000001',
};

const venues = [
  { name: 'Euphoria Downtown', streetAddress: '110 S Orange Ave', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5405, longitude: -81.3792, description: 'Vibrant venue with live performances and themed parties.' },
  { name: 'Room 22', streetAddress: '114 S Orange Ave', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5408, longitude: -81.3795, description: "Downtown Orlando's premier show bar." },
  { name: 'Parlay', streetAddress: '39 N Orange Ave', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5421, longitude: -81.3798, description: 'Trendy spot known for its lively atmosphere.' },
  { name: 'Proper', streetAddress: '101 E Central Blvd', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.54, longitude: -81.379, description: 'Upscale venue offering a refined nightlife experience.' },
  { name: 'Celine', streetAddress: '22 S Magnolia Ave', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5402, longitude: -81.3793, description: 'Chic venue offering live music and DJ sets.' },
  { name: 'Tier', streetAddress: '20 E Central Blvd', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5403, longitude: -81.3794, description: 'High-energy nightclub with vibrant atmosphere.' },
  { name: 'Eden', streetAddress: '23 E Central Blvd', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5404, longitude: -81.3796, description: 'Modern lounge with diverse entertainment options.' },
  { name: 'Aura', streetAddress: '49 N Orange Ave', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5406, longitude: -81.3797, description: 'Premier nightclub offering a dynamic experience.' },
  { name: 'La Rosa', streetAddress: '123 W Church St', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5407, longitude: -81.38, description: 'Cozy venue with intimate live music.' },
  { name: 'Shakai', streetAddress: '456 W Church St', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5409, longitude: -81.3801, description: 'Vibrant spot with entertainment and dining.' },
  { name: 'Fixtion', streetAddress: '789 W Church St', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.541, longitude: -81.3802, description: 'Energetic venue with themed events.' },
  { name: 'The Beacham', streetAddress: '46 N Orange Ave', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5401, longitude: -81.3799, description: 'Iconic venue with live performances and events.' },
];

const managerNames = ['Sam Rivera', 'Nia Bennett', 'Marcus Reed', 'Elena Torres', 'Jordan Lee', 'Avery Brooks', 'Camila Diaz', 'Noah Grant', 'Sofia Patel', 'Andre Lewis', 'Taylor Morgan', 'Dani Cruz'];
const promoterNames = [
  ['Leo Carter', 'Zoe Mitchell'], ['Milan Davis', 'Jade Foster'], ['Chris Walker', 'Ari Monroe'], ['Devin Ross', 'Mia Stone'],
  ['Nico James', 'Layla Woods'], ['Jalen King', 'Riley Hart'], ['Omar Ellis', 'Gia Price'], ['Drew Parker', 'Ivy Cole'],
  ['Kai Hughes', 'Lena Scott'], ['Eli Turner', 'Maya Flores'], ['Roman Bell', 'Skye Adams'], ['Ace Martin', 'Nova Young'],
];
const customerNames = ['Jordan Customer', 'Amelia Brown', 'Ethan Wilson', 'Olivia Garcia', 'Lucas Martinez', 'Mia Robinson', 'Mateo Clark', 'Ava Rodriguez', 'Elijah Lewis', 'Isabella Hall', 'James Allen', 'Sophia Wright', 'Liam Hernandez', 'Harper King', 'Benjamin Lopez', 'Evelyn Hill', 'Daniel Green', 'Luna Baker'];
const eventDays = [
  { label: 'Friday', short: 'FRI', title: 'Friday Nights', gaPriceCents: 1000, commissionBps: 900, directGuestlistCapacity: 50, guestlistAllocation: 20 },
  { label: 'Saturday', short: 'SAT', title: 'Saturday Sessions', gaPriceCents: 1000, commissionBps: 1200, directGuestlistCapacity: 75, guestlistAllocation: 25 },
  { label: 'Sunday', short: 'SUN', title: 'Sunday Social', gaPriceCents: 1000, commissionBps: 700, directGuestlistCapacity: 40, guestlistAllocation: 15 },
];
const packageTemplates = [
  { name: '2 Regular Bottles', description: 'Two regular bottles with a reserved table and admission for up to four guests.', priceCents: 30000, quantityTotal: 24 },
  { name: '2 Premium Bottles', description: 'Two premium bottles with a reserved table and admission for up to four guests.', priceCents: 40000, quantityTotal: 18 },
  { name: '2 Clase Azul / 1942 Bottles', description: 'Two bottles of Clase Azul or Don Julio 1942 with a reserved table and admission for up to four guests.', priceCents: 100000, quantityTotal: 10 },
];

function slugify(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function emailFor(name, suffix = '') { return `${slugify(name).replaceAll('-', '.')}${suffix}@nitewide.test`; }
function nextWeekend() {
  const friday = new Date();
  const daysUntilFriday = (5 - friday.getDay() + 7) % 7 || 7;
  friday.setDate(friday.getDate() + daysUntilFriday);
  friday.setHours(22, 0, 0, 0);
  return [0, 1, 2].map((offset) => { const date = new Date(friday); date.setDate(friday.getDate() + offset); return date; });
}

async function seed() {
  const config = getConfig();
  if (config.NODE_ENV === 'production' && !process.argv.includes('--allow-production')) throw new Error('Refusing to seed production without --allow-production');
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  try {
    await sequelize.authenticate();
    await sequelize.truncate({ cascade: true });
    const managerUsers = managerNames.map((displayName, index) => ({ id: index === 0 ? ids.employee : randomUUID(), displayName, email: emailFor(displayName, '.manager') }));
    const promoterUsers = promoterNames.flatMap((names, venueIndex) => names.map((displayName, promoterIndex) => ({
      id: venueIndex === 0 && promoterIndex === 0 ? ids.promoter : randomUUID(), displayName,
      email: emailFor(displayName, `.promoter${venueIndex + 1}`),
    })));
    const customerUsers = customerNames.map((displayName, index) => ({
      id: index === 0 ? ids.customer : randomUUID(), displayName, email: emailFor(displayName, `.customer${index + 1}`),
      marketingConsentAt: index % 3 === 0 ? new Date() : null,
    }));
    await models.User.bulkCreate([
      { id: ids.admin, email: 'admin@nitewide.test', displayName: 'Nitewide Admin', isInternalAdmin: true },
      { id: ids.owner, email: 'maya.owner@nitewide.test', displayName: 'Maya Portfolio Owner', marketingConsentAt: new Date() },
      ...managerUsers, ...promoterUsers, ...customerUsers,
    ]);
    const seededUsers = await models.User.findAll({ attributes: ['id'] });
    await models.UserCredential.bulkCreate(await Promise.all(seededUsers.map(async (user) => ({ userId: user.id, ...(await createPasswordRecord(demoPassword)) }))));

    const weekendDates = nextWeekend();
    const checkout = createCheckoutService({ sequelize, models });
    const guestlistService = createGuestlistService({ sequelize, models });
    let sampleGuestlistQrToken;
    for (const [venueIndex, venue] of venues.entries()) {
      const venueSlug = slugify(venue.name);
      const organization = await models.Organization.create({
        id: venueIndex === 0 ? ids.organization : randomUUID(), name: venue.name, slug: venueSlug,
        description: venue.description, planTier: venueIndex % 3 === 0 ? 'gold' : 'free',
      });
      const location = await models.Location.create({
        id: venueIndex === 0 ? ids.location : randomUUID(), name: venue.name, addressLine1: venue.streetAddress,
        city: venue.city, region: venue.state, postalCode: venue.zip, countryCode: 'US', timezone: 'America/New_York',
        latitude: venue.latitude, longitude: venue.longitude, geo: { type: 'Point', coordinates: [venue.longitude, venue.latitude] }, privacy: 'public',
      });
      const manager = managerUsers[venueIndex];
      const venuePromoters = promoterUsers.slice(venueIndex * 2, venueIndex * 2 + 2);
      await models.OrganizationOwner.bulkCreate([
        { organizationId: organization.id, userId: ids.owner, role: 'owner' },
        { organizationId: organization.id, userId: manager.id, role: 'admin' },
      ]);
      const staffAffiliate = await models.OrgAffiliate.create({
        organizationId: organization.id, userId: manager.id, code: `${venueSlug}-STAFF`.toUpperCase(),
        defaultCommissionBps: 0, defaultGuestlistAllocation: 6,
      });
      const orgAffiliates = [];
      for (const [promoterIndex, promoter] of venuePromoters.entries()) {
        orgAffiliates.push(await models.OrgAffiliate.create({
          id: venueIndex === 0 && promoterIndex === 0 ? ids.orgAffiliate : randomUUID(), organizationId: organization.id,
          userId: promoter.id, code: `${venueSlug}-P${promoterIndex + 1}`.toUpperCase(),
          defaultCommissionBps: promoterIndex === 0 ? 800 : 1000, defaultGuestlistAllocation: promoterIndex === 0 ? 10 : 12,
        }));
      }
      for (const [dayIndex, day] of eventDays.entries()) {
        const startsAt = new Date(weekendDates[dayIndex]);
        const endsAt = new Date(startsAt.getTime() + 4.5 * 60 * 60 * 1000);
        const event = await models.Event.create({
          id: venueIndex === 0 && dayIndex === 0 ? ids.event : randomUUID(), creatorUserId: manager.id,
          organizationId: organization.id, locationId: location.id, title: `${venue.name} ${day.title}`,
          slug: `${venueSlug}-${day.short.toLowerCase()}`, summary: `${day.label} nightlife at ${venue.name} in the ${venue.metroArea} area.`,
          description: `${venue.description} Doors open at 10 PM with music, guestlist access, general admission, and table packages available.`,
          category: 'nightlife', status: 'published', startsAt, endsAt, capacity: 500, guestlistCapacity: day.directGuestlistCapacity,
        });
        const eventAffiliates = [];
        for (const [promoterIndex, promoter] of venuePromoters.entries()) {
          eventAffiliates.push(await models.EventAffiliate.create({
            id: venueIndex === 0 && dayIndex === 0 && promoterIndex === 0 ? ids.eventAffiliate : randomUUID(),
            eventId: event.id, userId: promoter.id, orgAffiliateId: orgAffiliates[promoterIndex].id,
            code: `${venueSlug}-${day.short}-P${promoterIndex + 1}`.toUpperCase(),
            commissionBps: day.commissionBps + promoterIndex * 100, guestlistAllocation: day.guestlistAllocation,
          }));
        }
        const salesStartAt = new Date(); salesStartAt.setDate(salesStartAt.getDate() - 7);
        const salesEndAt = new Date(startsAt.getTime() - 60 * 60 * 1000);
        const offerings = await models.Offering.bulkCreate([
          {
            id: venueIndex === 0 && dayIndex === 0 ? ids.generalAdmission : randomUUID(), eventId: event.id,
            name: 'General Admission', description: 'Single admission credential. Entry subject to venue policies.', kind: 'ticket',
            priceCents: day.gaPriceCents, quantityTotal: 350, entriesPerUnit: 1, maxPerOrder: 8, salesStartAt, salesEndAt, sortOrder: 1,
          },
          ...packageTemplates.map((template, packageIndex) => ({
            id: venueIndex === 0 && dayIndex === 0 && packageIndex === 0 ? ids.regularPackage : randomUUID(),
            eventId: event.id, ...template, kind: 'package', entriesPerUnit: 4, maxPerOrder: 2,
            salesStartAt, salesEndAt, sortOrder: packageIndex + 2,
          })),
        ]);
        const gaOffering = offerings[0];
        const packageOffering = offerings[1 + ((venueIndex + dayIndex) % packageTemplates.length)];
        const gaBuyer = customerUsers[(venueIndex * 3 + dayIndex) % customerUsers.length];
        const packageBuyer = customerUsers[(venueIndex * 3 + dayIndex + 5) % customerUsers.length];
        await checkout({
          buyerUserId: gaBuyer.id, eventId: event.id, idempotencyKey: `seed-${venueSlug}-${day.short.toLowerCase()}-ga`,
          affiliateCode: eventAffiliates[0].code, items: [{ offeringId: gaOffering.id, quantity: 2 + (dayIndex % 2) }],
          payment: { provider: 'seed', reference: `seed-pay-${venueSlug}-${day.short.toLowerCase()}-ga`, status: 'succeeded' },
        });
        await checkout({
          buyerUserId: packageBuyer.id, eventId: event.id, idempotencyKey: `seed-${venueSlug}-${day.short.toLowerCase()}-package`,
          affiliateCode: eventAffiliates[1].code, items: [{ offeringId: packageOffering.id, quantity: 1 }],
          payment: { provider: 'seed', reference: `seed-pay-${venueSlug}-${day.short.toLowerCase()}-package`, status: 'succeeded' },
        });
        const affiliateGuest = customerUsers[(venueIndex + dayIndex + 9) % customerUsers.length];
        const directGuest = customerUsers[(venueIndex + dayIndex + 13) % customerUsers.length];
        const affiliateRequest = await guestlistService.request({ userId: affiliateGuest.id, eventId: event.id, partySize: 2, affiliateCode: eventAffiliates[0].code });
        const affiliateApproval = await guestlistService.review({ eventId: event.id, entryId: affiliateRequest.entry.id, reviewedByUserId: manager.id, decision: 'approve', note: 'Approved by venue manager during seed.' });
        const directRequest = await guestlistService.request({ userId: directGuest.id, eventId: event.id, partySize: 2 });
        await guestlistService.review({ eventId: event.id, entryId: directRequest.entry.id, reviewedByUserId: manager.id, decision: 'approve', note: 'Approved by venue manager during seed.' });
        sampleGuestlistQrToken ||= affiliateApproval.qrToken;
        await models.AuditLog.create({
          actorUserId: manager.id, organizationId: organization.id, entityType: 'Event', entityId: event.id,
          action: 'event.seeded', after: { day: day.label, employeeAffiliateId: staffAffiliate.id },
        });
      }
    }
    const counts = {
      users: await models.User.count(), organizations: await models.Organization.count(), events: await models.Event.count(),
      offerings: await models.Offering.count(), orgAffiliates: await models.OrgAffiliate.count(),
      eventAffiliates: await models.EventAffiliate.count(), paidOrders: await models.Order.count({ where: { status: 'paid' } }),
      guestlistEntries: await models.GuestlistEntry.count(), tickets: await models.Ticket.count(),
    };
    console.log('Seed complete:', counts);
    console.log('Stable development identities:', { admin: ids.admin, owner: ids.owner, promoter: ids.promoter, customer: ids.customer, employee: ids.employee, event: ids.event });
    console.log('Demo sign-in password:', demoPassword);
    console.log('Sample guestlist QR token:', sampleGuestlistQrToken);
  } finally { await sequelize.close(); }
}

seed().catch((error) => { console.error(error); process.exitCode = 1; });
