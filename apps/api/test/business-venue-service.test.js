const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createBusinessVenueService, venueTeamSchema, venueCreateSchema, venueUpdateSchema } = require('../src/services/business-venue-service');
const ID = { org: crypto.randomUUID(), actor: crypto.randomUUID(), venue: crypto.randomUUID(), otherVenue: crypto.randomUUID(), user: crypto.randomUUID() };
const why = 'Confirmed scoped venue permission change';
function fixture({ orgRole = 'owner', venueRole = null } = {}) {
  const audit = []; const assignments = [];
  const make = (values) => ({ ...values, toJSON() { return { ...this }; }, async update(changes) { Object.assign(this, changes); this.version += 1; return this; } });
  const organization = make({ id: ID.org, version: 1, status: 'active', lifecycleState: 'active', locationId: ID.venue });
  const venue = make({ id: ID.venue, version: 0, name: 'Venue', lifecycleState: 'active' });
  const user = make({ id: ID.user, version: 0, isActive: true, lifecycleState: 'active', displayName: 'Existing User', email: 'user@example.test' });
  const actor = { id: ID.actor, isActive: true, lifecycleState: 'active' };
  const actorGrant = venueRole ? { id: 'actor-grant', userId: ID.actor, locationId: ID.venue, organizationId: ID.org, role: venueRole, status: 'active' } : null;
  const sequelize = { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: 'UPDATE' } }) };
  const models = { Organization: { sequelize, findByPk: async () => organization, update: async () => [1, [{ version: ++organization.version }]] },
    User: { findByPk: async (id) => id === ID.actor ? actor : user, update: async () => [1, [{ version: ++user.version }]] },
    OrganizationOwner: { findOne: async () => orgRole ? { role: orgRole } : null }, OrganizationEmployee: { findOne: async () => null }, OrgAffiliate: { findOne: async () => null },
    OrganizationVenue: { findOne: async ({ where }) => where.organizationId === ID.org ? {} : null, create: async () => ({}) },
    Location: { findByPk: async (id) => id === ID.venue ? venue : make({ id, version: 0, lifecycleState: 'active' }), create: async (values) => make({ id: crypto.randomUUID(), version: 0, lifecycleState: 'active', ...values }) },
    VenueAccess: { findAll: async () => actorGrant ? [actorGrant] : [], findOne: async ({ where }) => where.userId === ID.actor ? (actorGrant && (!where.locationId || where.locationId === actorGrant.locationId) ? actorGrant : null) : assignments[0] || null,
      create: async (values) => { const row = make({ id: crypto.randomUUID(), version: 0, ...values }); assignments.push(row); return row; } },
    Event: { count: async () => 1 }, EventAffiliate: { findAll: async () => [] }, AuditLog: { create: async (values) => audit.push(values) } };
  const service = createBusinessVenueService({ models, permissions: { assertInternalPermission: async () => {} } });
  return { service, venue, assignments, audit, user };
}
test('venue schemas require optimistic versions and reject finance or organization-role fields', () => {
  assert.equal(venueTeamSchema.parse({ role: 'employee', reason: why, version: null }).version, null);
  assert.equal(venueTeamSchema.safeParse({ role: 'owner', reason: why, version: null }).success, false);
  assert.equal(venueTeamSchema.safeParse({ role: 'manager', reason: why, version: null, financeAuthorized: true }).success, false);
  assert.equal(venueCreateSchema.safeParse({ venue: {}, reason: why }).success, false);
  assert.equal('privacy' in venueUpdateSchema.parse({ name: 'Renamed', reason: why, version: 0 }), false, 'patches do not apply creation defaults');
});
test('organization leaders create fresh exclusive venues without changing existing stored identities', async () => {
  const { service, audit } = fixture();
  const created = await service.create(ID.actor, ID.org, { venue: { name: 'New Venue', addressLine1: '100 Main', city: 'Orlando', countryCode: 'US', timezone: 'America/New_York' }, reason: why, version: 1 }, false);
  assert.equal(created.name, 'New Venue'); assert.equal(created.organizationId, ID.org); assert.equal(created.addressLocked, false); assert.equal(created.organizationVersion, 2); assert.equal(audit[0].action, 'venue.created');
});
test('venue managers rename only their venue and cannot create organization venues or rewrite event address history', async () => {
  const { service, venue } = fixture({ orgRole: null, venueRole: 'manager' });
  const renamed = await service.update(ID.actor, ID.org, ID.venue, { name: 'Renamed Venue', reason: why, version: 0 }, false);
  assert.equal(renamed.name, 'Renamed Venue'); assert.equal(renamed.version, 1);
  await assert.rejects(service.update(ID.actor, ID.org, ID.otherVenue, { name: 'Other', reason: why, version: 0 }, false), { code: 'FORBIDDEN' });
  await assert.rejects(service.update(ID.actor, ID.org, ID.venue, { city: 'Moved city', reason: why, version: venue.version }, false), { code: 'VENUE_ADDRESS_HISTORY_LOCKED' });
  const venueInput = { name: 'New', addressLine1: '100 Main', city: 'Miami', countryCode: 'US', timezone: 'America/New_York' };
  await assert.rejects(service.create(ID.actor, ID.org, { venue: venueInput, reason: why, version: 2 }, false), { code: 'FORBIDDEN' });
});
test('only owners can grant/change/remove venue managers; venue manager grants create no org membership or finance', async () => {
  for (const authority of [{ orgRole: 'admin' }, { orgRole: null, venueRole: 'manager' }]) {
    const { service, assignments } = fixture(authority);
    await assert.rejects(service.saveMember(ID.actor, ID.org, ID.venue, ID.user, { role: 'manager', status: 'active', reason: why, version: null }, false), { code: 'FORBIDDEN' });
    const employee = await service.saveMember(ID.actor, ID.org, ID.venue, ID.user, { role: 'employee', status: 'active', reason: why, version: null }, false);
    assert.equal(employee.role, 'employee'); assert.equal(employee.organizationId, ID.org); assert.equal(employee.locationId, ID.venue); assert.equal('financeAuthorized' in employee, false);
    await assert.rejects(service.saveMember(ID.actor, ID.org, ID.venue, ID.user, { role: 'promoter', reason: why, version: null }, false), { code: 'STALE_VERSION' });
    assignments[0].role = 'manager';
    await assert.rejects(service.saveMember(ID.actor, ID.org, ID.venue, ID.user, { role: 'employee', status: 'inactive', reason: why, version: employee.version }, false), { code: 'FORBIDDEN' });
  }
  const { service, audit } = fixture();
  const manager = await service.saveMember(ID.actor, ID.org, ID.venue, ID.user, { role: 'manager', status: 'active', reason: why, version: null }, false);
  const removed = await service.saveMember(ID.actor, ID.org, ID.venue, ID.user, { role: 'manager', status: 'inactive', reason: why, version: manager.version }, false);
  assert.equal(removed.status, 'inactive'); assert.equal(audit.length, 2); assert.equal(audit[1].after.adminReason, why);
});
