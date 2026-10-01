const test = require('node:test');
const assert = require('node:assert/strict');
const { currentVenueMembership, venueAssignmentCurrent, venueMemberSql, venueManagerSql } = require('../src/services/venue-access-policy');
const { createPermissionService } = require('../src/services/permission-service');
const { resolveAffiliate } = require('../src/services/affiliate-service');

function fixture() {
  const grant = { id: 'grant', userId: 'user', organizationId: 'org', locationId: 'venue', role: 'manager', status: 'active' };
  const organization = { id: 'org', lifecycleState: 'active', status: 'active' };
  const event = { id: 'event', organizationId: 'org', locationId: 'venue', lifecycleState: 'active', status: 'published' };
  const assignment = { eventId: 'event', userId: 'user', venueAccessId: 'grant', accessScope: 'venue', code: 'VENUE-code', status: 'active', commissionBps: 0 };
  const models = { User: { findByPk: async () => ({ id: 'user', isActive: true, lifecycleState: 'active' }) },
    Organization: { findByPk: async (id) => id === 'org' ? organization : null }, Location: { findByPk: async () => ({ lifecycleState: 'active' }) },
    OrganizationVenue: { findOne: async ({ where }) => where.organizationId === 'org' && ['venue', 'other-venue'].includes(where.locationId) ? {} : null },
    VenueAccess: { findOne: async ({ where }) => Object.entries(where).every(([key, value]) => grant[key] === value) ? grant : null },
    OrganizationOwner: { findOne: async () => null }, OrganizationEmployee: { findOne: async () => null }, OrgAffiliate: { findOne: async () => null },
    Event: { findByPk: async () => event }, EventAffiliate: { findOne: async () => assignment, findAll: async () => [assignment] } };
  return { grant, organization, event, assignment, models, permissions: createPermissionService(models) };
}
test('venue scope SQL cannot accept injected aliases or roles and requires exact ownership', () => {
  assert.match(venueMemberSql('e'), /venue_grant_e\.location_id = e\.location_id/);
  assert.match(venueManagerSql('evt'), /venue_grant_evt\.role IN \('manager'\)/);
  assert.match(venueMemberSql('ov'), /venue_grant_ov\.location_id = ov\.location_id/);
  assert.equal(/organization_venues ov\b/.test(venueMemberSql('ov')), false, 'outer ownership alias is never shadowed');
  assert.throws(() => venueMemberSql('e; DROP TABLE users'));
  assert.throws(() => venueMemberSql('e', ['owner']));
});
test('venue manager grants create/manage authority only for their exact managed venue, never organization or finance', async () => {
  const { models, event, grant, permissions } = fixture();
  assert.equal((await currentVenueMembership(models, event, 'user')).id, 'grant');
  await permissions.assertCreateEvent('user', 'org', 'venue'); await permissions.assertManageEvent('user', 'event');
  assert.equal(await permissions.canManageOrganization('user', 'org'), false); assert.equal(await permissions.canManageFinance('user', 'org'), false);
  for (const locationId of ['other-venue', 'address-snapshot', null]) await assert.rejects(permissions.assertCreateEvent('user', 'org', locationId), { code: 'FORBIDDEN' });
  for (const role of ['employee', 'promoter']) { grant.role = role; await assert.rejects(permissions.assertManageEvent('user', 'event'), { code: 'FORBIDDEN' }); await assert.rejects(permissions.assertCreateEvent('user', 'org', 'venue'), { code: 'FORBIDDEN' }); await permissions.assertAdmitEvent('user', 'event'); }
});
test('venue references reject revoked, re-bound, moved, and suspended grants at the final affiliate resolution', async () => {
  const { models, event, grant, organization, assignment } = fixture();
  assert.equal(await venueAssignmentCurrent(models, assignment, event), true);
  assert.equal((await resolveAffiliate(models, { event, code: assignment.code })).eventAffiliate, assignment);
  assignment.venueAccessId = 'different-grant'; await assert.rejects(resolveAffiliate(models, { event, code: assignment.code }), { code: 'INVALID_AFFILIATE' });
  assignment.venueAccessId = 'grant'; grant.status = 'inactive'; await assert.rejects(resolveAffiliate(models, { event, code: assignment.code }), { code: 'INVALID_AFFILIATE' });
  grant.status = 'active'; event.locationId = 'other-venue'; await assert.rejects(resolveAffiliate(models, { event, code: assignment.code }), { code: 'INVALID_AFFILIATE' });
  event.locationId = 'venue'; organization.status = 'suspended'; organization.lifecycleState = 'suspended';
  assert.equal(await currentVenueMembership(models, event, 'user'), null);
  assert.equal((await currentVenueMembership(models, event, 'user', undefined, { allowSuspendedOrganization: true })).id, grant.id, 'existing admissions may survive business suspension');
});
test('exclusive venue migration audits duplicate parents and refuses to silently reassign or discard history', async () => {
  const migration = require('../src/db/migrations/202610010004-managed-venue-access.cjs');
  let writes = 0;
  const q = { sequelize: { transaction: async (run) => run({}), query: async (sql) => sql.startsWith('LOCK') ? [[], {}] : [[{ location_id: 'duplicate', organizations: ['one', 'two'] }], {}] },
    addIndex: async () => { writes += 1; }, createTable: async () => { writes += 1; }, dropTable: async () => { writes += 1; } };
  await assert.rejects(migration.up(q, {}), /must be reviewed/); assert.equal(writes, 0);
  await assert.rejects(migration.down(q), /preservation plan/); assert.equal(writes, 0);
});
