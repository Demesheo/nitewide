const test = require('node:test');
const assert = require('node:assert/strict');
const { adminEventInput, createAdminEventService } = require('../src/services/admin-event-service');

const organizationId = '20000000-0000-4000-8000-000000000001';
const eventId = '30000000-0000-4000-8000-000000000001';
function input() {
  return { organizationId, locationId: null, title: 'Summer night', summary: '', description: '',
    startsAt: '2027-08-01T23:00:00Z', endsAt: '2027-08-02T03:00:00Z', guestlistCapacity: 0,
    capacity: null, status: 'draft', isDiscoverable: true, offerings: [],
    location: { name: 'Independent event space', addressLine1: '1 Main St', city: 'Orlando', region: 'FL',
      postalCode: '32801', timezone: 'America/New_York', privacy: 'public' }, adminReason: 'Reviewed event configuration' };
}
test('admin editor preserves the shared tier/date/address validation and requires an audit reason', () => {
  assert.equal(adminEventInput.safeParse(input()).success, true);
  assert.equal(adminEventInput.safeParse({ ...input(), adminReason: '' }).success, false);
  assert.equal(adminEventInput.safeParse({ ...input(), endsAt: input().startsAt }).success, false);
  assert.equal(adminEventInput.safeParse({ ...input(), location: undefined }).success, false);
});
test('new admin events belong to an accepted business contact, not the administrator', async () => {
  const calls = [];
  const service = createAdminEventService({ models: { OrganizationOwner: { findAll: async () => [
    { userId: 'manager', role: 'admin' }, { userId: 'owner', role: 'owner' },
  ] } }, permissions: { assertInternalPermission: async (...args) => calls.push(args) },
  business: { saveEvent: async (...args) => { calls.push(args); return { id: eventId }; } } });
  await service.save('administrator', null, input());
  assert.deepEqual(calls[0].slice(0, 2), ['administrator', 'events.manage']);
  assert.equal(calls[1][0], 'administrator'); assert.equal(calls[1][3].creatorUserId, 'owner');
  assert.equal(calls[1][3].adminReason, input().adminReason);
  assert.equal(calls[1][2].locationId, null); assert.equal('adminReason' in calls[1][2], false);
});
test('manager-led businesses may create events but businesses without an accepted contact may not', async () => {
  let members = [{ userId: 'manager', role: 'admin' }]; let saved = 0;
  const service = createAdminEventService({ models: { OrganizationOwner: { findAll: async () => members } },
    permissions: { assertInternalPermission: async () => {} }, business: { saveEvent: async (_actor, _id, _input, options) => { saved++; assert.equal(options.creatorUserId, 'manager'); } } });
  await service.save('admin', null, input()); assert.equal(saved, 1);
  members = []; await assert.rejects(service.save('admin', null, input()), { code: 'BUSINESS_CONTACT_REQUIRED' });
  await assert.rejects(service.save('admin', null, { ...input(), organizationId: null }), { code: 'BUSINESS_REQUIRED' });
  assert.equal(saved, 1);
});
test('event edits retain the existing creator and pass the version into the shared mutation', async () => {
  let saved;
  const service = createAdminEventService({ models: {}, permissions: { assertInternalPermission: async () => {} },
    business: { saveEvent: async (...args) => { saved = args; } } });
  await service.save('admin', eventId, { ...input(), version: 3 });
  assert.equal(saved[1], eventId); assert.equal(saved[2].version, 3); assert.equal(saved[3].creatorUserId, null);
});
test('denied staff cannot read contact identities or enter the event mutation', async () => {
  const service = createAdminEventService({ models: new Proxy({}, { get() { throw Error('No data reads allowed'); } }),
    permissions: { assertInternalPermission: async () => { const error = Error('Forbidden'); error.status = 403; throw error; } },
    business: { saveEvent: () => { throw Error('No writes allowed'); } } });
  await assert.rejects(service.save('support', null, input()), { status: 403 });
  await assert.rejects(service.editor('support', eventId), { status: 403 });
});
