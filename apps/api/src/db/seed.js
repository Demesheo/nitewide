require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
const { randomUUID } = require('node:crypto');
const { getConfig } = require('../config');
const { createSequelize } = require('./sequelize');
const { initModels } = require('./models');
const { createCheckoutService } = require('../services/checkout-service');
const { createGuestlistService } = require('../services/guestlist-service');
const { createPasswordRecord } = require('../services/auth-service');
const { importPoshSnapshot } = require('./posh-importer');
const poshSnapshot = require('./fixtures/posh-orlando-2026-09-21');

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
  { name: 'OHM', legacySlug: 'tier', streetAddress: '20 E Central Blvd', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5403, longitude: -81.3794, description: 'High-energy nightclub, formerly Tier, with a vibrant atmosphere.' },
  { name: 'Eden', streetAddress: '23 E Central Blvd', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5404, longitude: -81.3796, description: 'Modern lounge with diverse entertainment options.' },
  { name: 'Aura', streetAddress: '49 N Orange Ave', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5406, longitude: -81.3797, description: 'Premier nightclub offering a dynamic experience.' },
  { name: 'La Rosa', streetAddress: '123 W Church St', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5407, longitude: -81.38, description: 'Cozy venue with intimate live music.' },
  { name: 'Shakai', streetAddress: '456 W Church St', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5409, longitude: -81.3801, description: 'Vibrant spot with entertainment and dining.' },
  { name: 'Fixtion', streetAddress: '789 W Church St', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.541, longitude: -81.3802, description: 'Energetic venue with themed events.' },
  { name: 'The Beacham', streetAddress: '46 N Orange Ave', city: 'Orlando', state: 'FL', zip: '32801', metroArea: 'Orlando-Kissimmee', latitude: 28.5401, longitude: -81.3799, description: 'Iconic venue with live performances and events.' },
];

const managerNames = ['Sam Rivera', 'Nia Bennett', 'Marcus Reed', 'Elena Torres', 'Jordan Lee', 'Avery Brooks', 'Camila Diaz', 'Noah Grant', 'Sofia Patel', 'Andre Lewis', 'Taylor Morgan', 'Dani Cruz'];
const employeeNames = ['Tessa Ward', 'Miles Howard', 'Renee Coleman', 'Aiden Price', 'Brielle Sanders', 'Caleb Foster', 'Nora Brooks', 'Isaac Perry', 'Kira Flores', 'Julian Hayes', 'Alicia Gray', 'Theo Russell'];
const extraManagerFirstNames = ['Priya', 'Jamal', 'Nico', 'Ariana', 'Blake', 'Darius', 'Carmen', 'Miles'];
const extraManagerLastNames = ['Hale', 'Washington', 'Morales'];
const extraEmployeeFirstNames = ['Alex', 'Morgan', 'Casey', 'Taylor', 'Sydney', 'Jesse', 'Quinn', 'Harper', 'Reese', 'Skyler', 'Jamie', 'Avery', 'Riley', 'Peyton', 'Rowan'];
const extraEmployeeLastNames = ['Mitchell', 'Baker', 'Santos', 'Reynolds', 'Cooper', 'Brooks', 'Parker', 'Morris', 'Hayes', 'Fletcher', 'Cruz', 'Bennett', 'Dawson', 'Ramirez', 'Chen', 'Turner', 'Hughes', 'Young', 'Coleman', 'Diaz', 'Evans', 'Lopez', 'Russell', 'Sullivan'];
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
function teamCountsForVenue(venueIndex) {
  return { managers: 1 + ((venueIndex * 7 + 1) % 3), employees: 9 + ((venueIndex * 5 + 2) % 4) };
}
function managerFixture(venueIndex, managerIndex) {
  const index = venueIndex * 2 + managerIndex - 1;
  const displayName = managerIndex === 0 ? managerNames[venueIndex] : `${extraManagerFirstNames[index % extraManagerFirstNames.length]} ${extraManagerLastNames[Math.floor(index / extraManagerFirstNames.length)]}`;
  return { displayName, email: emailFor(displayName, managerIndex === 0 ? '.manager' : `.manager${venueIndex + 1}-${managerIndex + 1}`) };
}
function employeeFixture(venueIndex, employeeIndex) {
  const displayName = employeeIndex === 0 ? employeeNames[venueIndex] : (() => {
    const index = venueIndex * 11 + employeeIndex - 1;
    return `${extraEmployeeFirstNames[index % extraEmployeeFirstNames.length]} ${extraEmployeeLastNames[Math.floor(index / extraEmployeeFirstNames.length)]}`;
  })();
  const suffix = employeeIndex === 0 ? `.employee${venueIndex + 1}` : `.employee${venueIndex + 1}-${employeeIndex + 1}`;
  return { displayName, email: emailFor(displayName, suffix) };
}
function nextWeekend() {
  const friday = new Date();
  const daysUntilFriday = (5 - friday.getDay() + 7) % 7 || 7;
  friday.setDate(friday.getDate() + daysUntilFriday);
  friday.setHours(22, 0, 0, 0);
  return [0, 1, 2].map((offset) => { const date = new Date(friday); date.setDate(friday.getDate() + offset); return date; });
}
function recentWeekendDates() {
  const dates = [];
  const today = new Date();
  for (let daysAgo = 1; daysAgo <= 27; daysAgo += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - daysAgo);
    date.setHours(22, 0, 0, 0);
    if ([5, 6, 0].includes(date.getDay())) dates.push(date);
  }
  return dates.sort((a, b) => a - b);
}

async function seed() {
  const config = getConfig();
  if (config.NODE_ENV === 'production' && !process.argv.includes('--allow-production')) throw new Error('Refusing to seed production without --allow-production');
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  try {
    await sequelize.authenticate();
    await sequelize.truncate({ cascade: true });
    const managerUsersByVenue = venues.map((_, venueIndex) => Array.from({ length: teamCountsForVenue(venueIndex).managers }, (_, managerIndex) => ({ id: venueIndex === 0 && managerIndex === 0 ? ids.employee : randomUUID(), ...managerFixture(venueIndex, managerIndex) })));
    const managerUsers = managerUsersByVenue.flat();
    const employeeUsersByVenue = venues.map((_, venueIndex) => Array.from({ length: teamCountsForVenue(venueIndex).employees }, (_, employeeIndex) => ({ id: randomUUID(), ...employeeFixture(venueIndex, employeeIndex) })));
    const employeeUsers = employeeUsersByVenue.flat();
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
      ...managerUsers, ...employeeUsers, ...promoterUsers, ...customerUsers,
    ]);
    const seededUsers = await models.User.findAll({ attributes: ['id'] });
    await models.UserCredential.bulkCreate(await Promise.all(seededUsers.map(async (user) => ({ userId: user.id, ...(await createPasswordRecord(demoPassword)) }))));

    const weekendDates = nextWeekend();
    const historicalDates = recentWeekendDates();
    const guestlistService = createGuestlistService({ sequelize, models });
    let sampleGuestlistQrToken;
    for (const [venueIndex, venue] of venues.entries()) {
      const venueSlug = venue.legacySlug || slugify(venue.name);
      const organization = await models.Organization.create({
        id: venueIndex === 0 ? ids.organization : randomUUID(), name: venue.name, slug: venueSlug,
        description: venue.description, planTier: venueIndex % 3 === 0 ? 'premium' : 'free',
      });
      const location = await models.Location.create({
        id: venueIndex === 0 ? ids.location : randomUUID(), name: venue.name, addressLine1: venue.streetAddress,
        city: venue.city, region: venue.state, postalCode: venue.zip, countryCode: 'US', timezone: 'America/New_York',
        latitude: venue.latitude, longitude: venue.longitude, geo: { type: 'Point', coordinates: [venue.longitude, venue.latitude] }, privacy: 'public',
      });
      const manager = managerUsersByVenue[venueIndex][0];
      const venuePromoters = promoterUsers.slice(venueIndex * 2, venueIndex * 2 + 2);
      await models.OrganizationOwner.bulkCreate([
        { organizationId: organization.id, userId: ids.owner, role: 'owner' },
        ...managerUsersByVenue[venueIndex].map((person) => ({ organizationId: organization.id, userId: person.id, role: 'admin' })),
      ]);
      await models.OrganizationEmployee.bulkCreate(employeeUsersByVenue[venueIndex].map((employee) => ({ organizationId: organization.id, userId: employee.id, status: 'active' })));
      const orgAffiliates = [];
      for (const [promoterIndex, promoter] of venuePromoters.entries()) {
        orgAffiliates.push(await models.OrgAffiliate.create({
          id: venueIndex === 0 && promoterIndex === 0 ? ids.orgAffiliate : randomUUID(), organizationId: organization.id,
          userId: promoter.id, code: `${venueSlug}-P${promoterIndex + 1}`.toUpperCase(),
          defaultCommissionBps: promoterIndex === 0 ? 800 : 1000, defaultGuestlistAllocation: promoterIndex === 0 ? 10 : 12,
        }));
      }
      for (const [dateIndex, startsAt] of [...historicalDates, ...weekendDates].entries()) {
        const isUpcoming = dateIndex >= historicalDates.length;
        const dayIndex = [5, 6, 0].indexOf(startsAt.getDay());
        const day = eventDays[dayIndex];
        const dateKey = startsAt.toISOString().slice(0, 10);
        const endsAt = new Date(startsAt.getTime() + 4.5 * 60 * 60 * 1000);
        const event = await models.Event.create({
          id: isUpcoming && venueIndex === 0 && dayIndex === 0 ? ids.event : randomUUID(), creatorUserId: manager.id,
          organizationId: organization.id, locationId: location.id, title: `${venue.name} ${day.title}`,
          slug: `${venueSlug}-${day.short.toLowerCase()}-${dateKey}`, summary: `${day.label} nightlife at ${venue.name} in the ${venue.metroArea} area.`,
          description: `${venue.description} Doors open at 10 PM with music, guestlist access, general admission, and table packages available.`,
          category: 'nightlife', status: 'published', startsAt, endsAt, capacity: 500, guestlistCapacity: day.directGuestlistCapacity,
        });
        const eventAffiliates = [];
        for (const [promoterIndex, promoter] of venuePromoters.entries()) {
          eventAffiliates.push(await models.EventAffiliate.create({
            id: isUpcoming && venueIndex === 0 && dayIndex === 0 && promoterIndex === 0 ? ids.eventAffiliate : randomUUID(),
            eventId: event.id, userId: promoter.id, orgAffiliateId: orgAffiliates[promoterIndex].id,
            code: `${venueSlug}-${day.short}-${dateKey}-P${promoterIndex + 1}`.toUpperCase(),
            commissionBps: day.commissionBps + promoterIndex * 100, guestlistAllocation: day.guestlistAllocation,
          }));
        }
        const salesStartAt = new Date(startsAt.getTime() - 30 * 86400000);
        const salesEndAt = new Date(startsAt.getTime() - 60 * 60 * 1000);
        const offerings = await models.Offering.bulkCreate([
          {
            id: isUpcoming && venueIndex === 0 && dayIndex === 0 ? ids.generalAdmission : randomUUID(), eventId: event.id,
            name: 'General Admission', description: 'Single admission credential. Entry subject to venue policies.', kind: 'ticket',
            priceCents: day.gaPriceCents, quantityTotal: 350, entriesPerUnit: 1, maxPerOrder: 8, salesStartAt, salesEndAt, sortOrder: 1,
          },
          ...packageTemplates.map((template, packageIndex) => ({
            id: isUpcoming && venueIndex === 0 && dayIndex === 0 && packageIndex === 0 ? ids.regularPackage : randomUUID(),
            eventId: event.id, ...template, kind: 'package', entriesPerUnit: 4, maxPerOrder: 2,
            salesStartAt, salesEndAt, sortOrder: packageIndex + 2,
          })),
        ]);
        // Each event has several paid customers and every package tier represented.
        // A historical checkout's clock is backdated, so analytics uses a truthful
        // paidAt rather than treating every seeded sale as occurring today.
        const saleKinds = [0, 0, 0, 1, 2, 3];
        for (const [saleIndex, offeringIndex] of saleKinds.entries()) {
          const buyer = customerUsers[(venueIndex * 7 + dateIndex * 3 + saleIndex * 2) % customerUsers.length];
          const paidAt = isUpcoming
            ? new Date(Date.now() - (saleIndex + venueIndex % 3) * 3600000)
            : new Date(startsAt.getTime() - (saleIndex + 2) * 3600000);
          const checkout = createCheckoutService({ sequelize, models, now: () => paidAt });
          await checkout({
            buyerUserId: buyer.id, eventId: event.id,
            idempotencyKey: `seed-${venueSlug}-${dateKey}-${saleIndex}`,
            // A third of demo orders are direct, with no staff or promoter attribution.
            affiliateCode: [2, 5].includes(saleIndex) ? undefined : eventAffiliates[saleIndex % 2].code,
            items: [{ offeringId: offerings[offeringIndex].id, quantity: offeringIndex === 0 ? 1 + ((venueIndex + dateIndex + saleIndex) % 4) : 1 }],
            payment: { provider: 'seed', reference: `seed-pay-${venueSlug}-${dateKey}-${saleIndex}`, status: 'succeeded' },
          });
        }
        const affiliateGuest = customerUsers[(venueIndex + dayIndex + 9) % customerUsers.length];
        const directGuest = customerUsers[(venueIndex + dayIndex + 13) % customerUsers.length];
        const affiliateRequest = await guestlistService.request({ userId: affiliateGuest.id, eventId: event.id, partySize: 2, affiliateCode: eventAffiliates[0].code });
        const affiliateApproval = await guestlistService.review({ eventId: event.id, entryId: affiliateRequest.entry.id, reviewedByUserId: manager.id, decision: 'approve', note: 'Approved by venue manager during seed.' });
        const directRequest = await guestlistService.request({ userId: directGuest.id, eventId: event.id, partySize: 2 });
        await guestlistService.review({ eventId: event.id, entryId: directRequest.entry.id, reviewedByUserId: manager.id, decision: 'approve', note: 'Approved by venue manager during seed.' });
        sampleGuestlistQrToken ||= affiliateApproval.qrToken;
        await models.AuditLog.create({
          actorUserId: manager.id, organizationId: organization.id, entityType: 'Event', entityId: event.id,
          action: 'event.seeded', after: { day: day.label, employeeUserId: employeeUsers[venueIndex].id },
        });
      }
    }
    if (config.NODE_ENV !== 'production' && !process.argv.includes('--skip-posh')) {
      console.log('Verified Orlando demo events:', await importPoshSnapshot({ sequelize, models, config, snapshot: poshSnapshot, apply: true }));
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

if (require.main === module) seed().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { venues, eventDays, packageTemplates, employeeNames, teamCountsForVenue, managerFixture, employeeFixture, demoPassword, recentWeekendDates, nextWeekend, slugify, emailFor };
