// Repeatable, non-destructive guestlist fixtures for the local demo venues.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
const { createHash } = require('node:crypto');
const { Op } = require('sequelize');
const { getConfig } = require('../config');
const { createSequelize } = require('./sequelize');
const { initModels } = require('./models');
const { createPasswordRecord } = require('../services/auth-service');
const { createQrToken } = require('../domain/qr');

const guestlistCustomerNames = [
  'Chloe Navarro', 'Isaiah Brooks', 'Sienna Cruz', 'Owen Bennett',
  'Aaliyah Price', 'Caleb Moreno', 'Grace Ellis', 'Miles Foster',
  'Nora Blake', 'Julian Santos', 'Layla Chen', 'Evan Parker',
];
const futureStatuses = ['pending', 'confirmed', 'rejected', 'cancelled'];
const pastStatuses = ['checked_in', 'no_show', 'no_show'];
const staffReferralRoles = ['employee', 'employee', 'manager', 'employee', 'owner', 'employee'];

function fixtureEmail(index) { return `guestlist.demo${String(index + 1).padStart(2, '0')}@nitewide.test`; }

function planGuestlistFixtures(events, now = new Date()) {
  const upcoming = events.filter((event) => new Date(event.startsAt) >= now).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const pastByOrganization = new Map();
  for (const event of events.filter((item) => new Date(item.endsAt) < now).sort((a, b) => new Date(b.endsAt) - new Date(a.endsAt))) {
    const existing = pastByOrganization.get(event.organizationId) || [];
    if (existing.length < 2) { existing.push(event); pastByOrganization.set(event.organizationId, existing); }
  }
  const past = [...pastByOrganization.values()].flat();
  return [
    ...upcoming.flatMap((event, eventIndex) => [
      ...futureStatuses.map((status, statusIndex) => ({ event, status, userIndex: (eventIndex + statusIndex) % guestlistCustomerNames.length, referrerRole: null })),
      { event, status: 'pending', userIndex: (eventIndex + 4) % guestlistCustomerNames.length, referrerRole: 'promoter' },
      { event, status: 'pending', userIndex: (eventIndex + 5) % guestlistCustomerNames.length, referrerRole: staffReferralRoles[eventIndex % staffReferralRoles.length] },
    ]),
    ...past.flatMap((event, eventIndex) => [
      ...pastStatuses.map((status, statusIndex) => ({ event, status, userIndex: (eventIndex + statusIndex + 4) % guestlistCustomerNames.length, referrerRole: null })),
      { event, status: 'no_show', userIndex: (eventIndex + 7) % guestlistCustomerNames.length, referrerRole: 'promoter' },
      { event, status: 'no_show', userIndex: (eventIndex + 8) % guestlistCustomerNames.length, referrerRole: staffReferralRoles[eventIndex % staffReferralRoles.length] },
    ]),
  ];
}

async function addDemoGuestlists({ models, now = new Date() }) {
  const { venues, slugify, demoPassword } = require('./seed');
  const organizations = await models.Organization.findAll({ where: { slug: { [Op.in]: venues.map((venue) => venue.legacySlug || slugify(venue.name)) } } });
  if (!organizations.length) throw new Error('Demo venues are missing; run the baseline seed first');
  const events = await models.Event.findAll({ where: { organizationId: { [Op.in]: organizations.map((org) => org.id) }, status: 'published' } });
  const plan = planGuestlistFixtures(events, now);
  const affiliates = await models.EventAffiliate.findAll({ where: { eventId: { [Op.in]: events.map((event) => event.id) }, status: 'active' }, order: [['createdAt', 'ASC']] });
  const affiliateByEvent = new Map();
  for (const affiliate of affiliates) if (affiliate.orgAffiliateId && !affiliateByEvent.has(affiliate.eventId)) affiliateByEvent.set(affiliate.eventId, affiliate);
  const organizationIds = organizations.map((organization) => organization.id);
  const [leaders, employees] = await Promise.all([
    models.OrganizationOwner.findAll({ where: { organizationId: { [Op.in]: organizationIds } }, order: [['createdAt', 'ASC']] }),
    models.OrganizationEmployee.findAll({ where: { organizationId: { [Op.in]: organizationIds }, status: 'active' }, order: [['createdAt', 'ASC']] }),
  ]);
  const staffByOrganization = new Map(organizationIds.map((id) => [id, {
    owner: leaders.filter((person) => person.organizationId === id && person.role === 'owner'),
    manager: leaders.filter((person) => person.organizationId === id && person.role !== 'owner'),
    employee: employees.filter((person) => person.organizationId === id),
  }]));
  const customers = [];
  for (const [index, displayName] of guestlistCustomerNames.entries()) {
    const [user, created] = await models.User.findOrCreate({ where: { email: fixtureEmail(index) }, defaults: { displayName } });
    if (created) await models.UserCredential.create({ userId: user.id, ...(await createPasswordRecord(demoPassword)) });
    if (await models.Order.count({ where: { buyerUserId: user.id } })) throw new Error(`${user.email} has purchases and cannot be used as a guestlist-only demo customer`);
    customers.push(user);
  }
  let added = 0;
  let checkInsAdded = 0;
  for (const { event, status, userIndex, referrerRole } of plan) {
    const user = customers[userIndex];
    let affiliate = referrerRole === 'promoter' ? affiliateByEvent.get(event.id) : null;
    if (referrerRole && referrerRole !== 'promoter') {
      const team = staffByOrganization.get(event.organizationId)?.[referrerRole] || [];
      if (!team.length) throw new Error(`Demo venue ${event.organizationId} has no ${referrerRole} for its referral fixture`);
      const person = team[userIndex % team.length];
      const digest = createHash('sha256').update(`guestlist-staff:${event.id}:${person.userId}`).digest('hex').slice(0, 24);
      [affiliate] = await models.EventAffiliate.findOrCreate({ where: { eventId: event.id, userId: person.userId },
        defaults: { eventId: event.id, userId: person.userId, code: `NW-REF-${digest}`, commissionBps: 0, guestlistAllocation: 12, status: 'active' } });
    }
    if (referrerRole && !affiliate) throw new Error(`Demo event ${event.id} has no ${referrerRole} for its referral fixture`);
    const past = new Date(event.endsAt) < now;
    const requestedAt = past ? new Date(new Date(event.startsAt).getTime() - 6 * 3600000) : now;
    const reviewedAt = status === 'pending' ? null : new Date(requestedAt.getTime() + 3600000);
    const checkedInAt = status === 'checked_in' ? new Date(new Date(event.startsAt).getTime() + 3600000) : null;
    const qrTokenHash = ['confirmed', 'checked_in', 'no_show'].includes(status) ? createQrToken().hash : null;
    const [entry, created] = await models.GuestlistEntry.findOrCreate({
      where: { eventId: event.id, userId: user.id },
      defaults: { eventId: event.id, userId: user.id, source: referrerRole ? 'affiliate' : 'event', eventAffiliateId: affiliate?.id || null,
        partySize: 1, status,
        qrTokenHash, reviewedByUserId: reviewedAt ? event.creatorUserId : null, reviewedAt,
        reviewNote: reviewedAt ? 'Local guestlist demo fixture.' : null, checkedInAt, createdAt: requestedAt },
    });
    if (status === 'checked_in' && entry.status === 'checked_in') {
      const [, checkInCreated] = await models.CheckIn.findOrCreate({ where: { guestlistEntryId: entry.id },
        defaults: { eventId: event.id, guestlistEntryId: entry.id, checkedInByUserId: event.creatorUserId,
          method: 'manual', checkedInAt } });
      if (checkInCreated) checkInsAdded += 1;
    }
    if (!created) continue; // Never overwrite a real request or a changed demo status.
    added += 1;
    if (referrerRole) await models.AffiliateAttribution.create({ eventId: event.id, userId: user.id,
      orgAffiliateId: affiliate.orgAffiliateId, eventAffiliateId: affiliate.id, action: 'guestlist',
      occurredAt: requestedAt, metadata: { status: 'requested', demo: true } });
    await models.AuditLog.create({ actorUserId: user.id, organizationId: event.organizationId,
      entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.demo_seeded',
      after: { status, source: referrerRole ? 'referral' : 'direct', referrerRole, guestlistOnlyCustomer: true, noPurchase: true } });
  }
  return { customers: customers.length, futureEvents: new Set(plan.filter((item) => futureStatuses.includes(item.status)).map((item) => item.event.id)).size,
    pastEvents: new Set(plan.filter((item) => pastStatuses.includes(item.status)).map((item) => item.event.id)).size, entriesAdded: added, checkInsAdded };
}

async function main() {
  const config = getConfig();
  if (config.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname)) {
    throw new Error('Demo guestlist refresh requires a local non-production database');
  }
  const sequelize = createSequelize(config);
  try {
    await sequelize.authenticate();
    console.log('Guestlist demo refresh:', await addDemoGuestlists({ models: initModels(sequelize) }));
  } finally { await sequelize.close(); }
}
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { guestlistCustomerNames, futureStatuses, pastStatuses, staffReferralRoles, fixtureEmail, planGuestlistFixtures, addDemoGuestlists };
