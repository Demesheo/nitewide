const test = require('node:test');
const assert = require('node:assert/strict');
const { admissionOpen } = require('../src/domain/admission-policy');
const { checkIn } = require('../src/http/schemas');
const { createPermissionService } = require('../src/services/permission-service');
test('admission window includes both 24-hour boundaries, excludes drafts and cancelled events', () => {
  const event = { status: 'published', startsAt: '2026-09-25T02:00:00Z', endsAt: '2026-09-25T06:00:00Z' };
  for (const [time, allowed] of [['2026-09-24T01:59:59Z', false], ['2026-09-24T02:00:00Z', true], ['2026-09-26T06:00:00Z', true], ['2026-09-26T06:00:01Z', false]]) assert.equal(admissionOpen(event, new Date(time)), allowed);
  for (const status of ['draft', 'cancelled']) assert.equal(admissionOpen({ ...event, status }, new Date(event.startsAt)), false);
});
test('manual admission accepts a credential ID and kind, never an ambiguous QR/manual mixture', () => {
  const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(checkIn.safeParse({ eventId, credentialId: eventId, kind: 'ticket' }).success, true);
  assert.equal(checkIn.safeParse({ eventId, qrToken: 'fake-code' }).success, true);
  for (const input of [{ credentialId: eventId }, { credentialId: eventId, kind: 'ticket', qrToken: 'x' }, { credentialId: 'bad', kind: 'guestlist' }, { qrToken: 'x'.repeat(2049) }]) assert.equal(checkIn.safeParse({ eventId, ...input }).success, false);
});
test('admission access covers venue leaders, active employees and assigned promoters without widening sales permissions', async () => {
  let role = 'owner';
  const permissions = createPermissionService({
    User: { findByPk: async () => ({ isActive: role !== 'disabled', isInternalAdmin: role === 'admin' }) },
    Event: { findByPk: async () => ({ organizationId: 'org' }) },
    OrganizationOwner: { findOne: async () => ['owner', 'manager'].includes(role) ? {} : null },
    OrganizationEmployee: { findOne: async () => role === 'employee' ? {} : null },
    EventAffiliate: { findAll: async () => role === 'promoter' ? [{ code: 'PROMOTER' }] : role === 'former_employee' ? [{ code: 'STAFFEV-old' }] : role === 'former_owner' ? [{ code: 'LEADEV-old' }] : [] },
  });
  for (role of ['owner', 'manager', 'employee', 'promoter', 'admin']) await permissions.assertAdmitEvent('user', 'event');
  for (role of ['outsider', 'disabled', 'former_employee', 'former_owner']) await assert.rejects(permissions.assertAdmitEvent('user', 'event'), { code: 'FORBIDDEN' });
  role = 'promoter'; await assert.rejects(permissions.assertManageEvent('user', 'event'), { code: 'FORBIDDEN' });
});
