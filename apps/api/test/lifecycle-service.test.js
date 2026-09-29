const test = require('node:test');
const assert = require('node:assert/strict');
const {
  active,
  activeUser,
  assertActiveUser,
  assertActiveOrganization,
  assertActiveEvent,
  assertOrganizationVenue,
} = require('../src/services/lifecycle-service');

const USER = '10000000-0000-4000-8000-000000000001';
const ORG = '20000000-0000-4000-8000-000000000001';
const EVENT = '30000000-0000-4000-8000-000000000001';
const LOCATION = '40000000-0000-4000-8000-000000000001';
const OTHER_LOCATION = '40000000-0000-4000-8000-000000000002';

test('lifecycle helpers preserve legacy active rows but reject suspended, archived, inactive, and pending accounts', () => {
  assert.equal(active({ id: ORG }), true, 'pre-migration rows without lifecycleState remain active');
  assert.equal(active({ lifecycleState: 'active' }), true);
  assert.equal(active({ lifecycleState: 'suspended' }), false);
  assert.equal(active({ lifecycleState: 'archived' }), false);
  assert.equal(activeUser({ isActive: true, onboardingPending: false }), true);
  assert.equal(activeUser({ isActive: false }), false);
  assert.equal(activeUser({ onboardingPending: true }), false);
  assert.throws(() => assertActiveUser({ id: USER, isActive: false }), { code: 'FORBIDDEN' });
  assert.throws(() => assertActiveUser({ id: USER, onboardingPending: true }), { code: 'FORBIDDEN' });
});

test('active organization requires both lifecycle and legacy status to remain active', async () => {
  const organizations = new Map([
    [ORG, { id: ORG, lifecycleState: 'active', status: 'active' }],
  ]);
  const models = { Organization: { findByPk: async (id) => organizations.get(id) || null } };
  assert.equal((await assertActiveOrganization(models, ORG)).id, ORG);
  organizations.set(ORG, { id: ORG, lifecycleState: 'suspended', status: 'active' });
  await assert.rejects(() => assertActiveOrganization(models, ORG), { code: 'FORBIDDEN' });
  organizations.set(ORG, { id: ORG, lifecycleState: 'active', status: 'closed' });
  await assert.rejects(() => assertActiveOrganization(models, ORG), { code: 'FORBIDDEN' });
  await assert.rejects(() => assertActiveOrganization(models, '20000000-0000-4000-8000-000000000099'), { code: 'NOT_FOUND' });
});

test('event activity inherits organization and venue lifecycle, and independent events inherit creator lifecycle', async () => {
  const org = { id: ORG, lifecycleState: 'active', status: 'active' };
  const location = { id: LOCATION, lifecycleState: 'active' };
  const creator = { id: USER, lifecycleState: 'active', isActive: true, onboardingPending: false };
  const models = {
    Organization: { findByPk: async () => org },
    Location: { findByPk: async () => location },
    User: { findByPk: async () => creator },
  };
  const event = { id: EVENT, organizationId: ORG, locationId: LOCATION, creatorUserId: USER, lifecycleState: 'active' };
  assert.equal((await assertActiveEvent(models, event)).id, EVENT);
  org.lifecycleState = 'archived';
  await assert.rejects(() => assertActiveEvent(models, event), { code: 'FORBIDDEN' });
  org.lifecycleState = 'active';
  location.lifecycleState = 'suspended';
  await assert.rejects(() => assertActiveEvent(models, event), { code: 'FORBIDDEN' });
  location.lifecycleState = 'active';
  creator.onboardingPending = true;
  assert.equal((await assertActiveEvent(models, event)).id, EVENT, 'an organization event remains available to its active organization despite its creator being pending');
  const independentEvent = { ...event, organizationId: null, locationId: null };
  await assert.rejects(() => assertActiveEvent(models, independentEvent), { code: 'FORBIDDEN' });
  await assert.rejects(() => assertActiveEvent(models, null), { code: 'NOT_FOUND' });
});

test('organization events must reference an active linked venue, not another organization venue', async () => {
  let linkedId = LOCATION;
  const organization = { id: ORG, locationId: LOCATION };
  const models = {
    OrganizationVenue: { findOne: async ({ where }) => where.organizationId === ORG && where.locationId === linkedId ? { id: 'link' } : null },
    Location: { findByPk: async (id) => id === LOCATION ? { id, lifecycleState: 'active' } : id === OTHER_LOCATION ? { id, lifecycleState: 'active' } : null },
  };
  assert.equal((await assertOrganizationVenue(models, organization, LOCATION)).id, LOCATION);
  await assert.rejects(() => assertOrganizationVenue(models, organization, OTHER_LOCATION), { code: 'VENUE_PARENT_MISMATCH' });
  linkedId = OTHER_LOCATION;
  await assert.rejects(() => assertOrganizationVenue(models, organization, LOCATION), { code: 'VENUE_PARENT_MISMATCH' });
  await assert.rejects(() => assertOrganizationVenue(models, organization, null), { code: 'ORGANIZATION_LOCATION_REQUIRED' });
  models.Location.findByPk = async () => ({ id: LOCATION, lifecycleState: 'archived' });
  await assert.rejects(() => assertOrganizationVenue(models, organization, OTHER_LOCATION), { code: 'VENUE_INACTIVE' });
});
