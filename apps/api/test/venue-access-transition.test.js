const test = require('node:test');
const assert = require('node:assert/strict');
const { revokeOrganizationVenueAccess, revokeVenueInvitationLinks } = require('../src/services/venue-access-transition');

test('business removal revokes only its scoped venue grants and permanently invalidates exact-venue private links', async () => {
  const audit = [], queries = [];
  const grant = { id: 'grant', organizationId: 'org', locationId: 'venue', userId: 'user', status: 'active', toJSON() { return { ...this }; }, async update(values) { Object.assign(this, values); } };
  const models = { VenueAccess: { findAll: async ({ where }) => { assert.deepEqual(where, { organizationId: 'org', userId: 'user', status: 'active' }); return [grant]; } },
    EventAffiliate: { findAll: async ({ where }) => { assert.deepEqual(where, { venueAccessId: 'grant', accessScope: 'venue' }); return [{ id: 'assignment' }]; } },
    GuestlistInvitation: { sequelize: { query: async (sql, options) => { queries.push({ sql, ...options }); return []; } } }, AuditLog: { create: async (row) => audit.push(row) } };
  await revokeOrganizationVenueAccess({ models, organizationId: 'org', userId: 'user', actorUserId: 'actor', transaction: { LOCK: { UPDATE: 'UPDATE' } } });
  assert.equal(grant.status, 'inactive'); assert.equal(audit[0].action, 'venue.access.revoked_by_business_removal');
  assert.match(queries[0].sql, /e\.location_id = :locationId/); assert.equal(queries[0].replacements.locationId, 'venue');
  assert.equal(queries[1].replacements.eventAffiliateId, 'assignment'); assert.equal(queries.length, 2);
  queries.length = 0;
  await revokeVenueInvitationLinks({ models, grant, actorUserId: 'actor', transaction: {}, allPools: false });
  assert.equal(queries.length, 1, 'manager demotion revokes direct links without invalidating personal referral-pool history');
});
