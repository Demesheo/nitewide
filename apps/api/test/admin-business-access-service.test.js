const test = require('node:test');
const assert = require('node:assert/strict');
const { ownershipInvitationSchema, ownershipRemoveSchema, ownershipRecoverySchema, financePermissionSchema, createAdminBusinessAccessService } = require('../src/services/admin-business-access-service');
const { forbidden } = require('../src/domain/errors');

const USER = '10000000-0000-4000-8000-000000000001';
const BASE = { recipient: { email: 'incoming@example.test', displayName: 'Incoming Owner' }, version: 0, reason: 'Confirmed business ownership request' };
test('ownership invitations require an explicit pair of outgoing owner and retained role', () => {
  assert.equal(ownershipInvitationSchema.parse(BASE).recipient.role, 'owner');
  for (const partial of [{ outgoingOwnerUserId: USER }, { outgoingRole: 'employee' }]) assert.equal(ownershipInvitationSchema.safeParse({ ...BASE, ...partial }).success, false);
  for (const outgoingRole of ['manager', 'employee', 'remove']) assert.equal(ownershipInvitationSchema.parse({ ...BASE, outgoingOwnerUserId: USER, outgoingRole }).outgoingRole, outgoingRole);
  assert.equal(ownershipInvitationSchema.safeParse({ ...BASE, recipient: { ...BASE.recipient, role: 'manager' } }).success, false);
  assert.equal(ownershipInvitationSchema.safeParse({ ...BASE, recipient: { ...BASE.recipient, financeAuthorized: true } }).success, false);
});
test('ownership removal and recovery require explicit choices and reject token/password injection', () => {
  assert.equal(ownershipRemoveSchema.safeParse({ version: 0, reason: BASE.reason }).success, false);
  assert.equal(ownershipRecoverySchema.safeParse({ version: 0, reason: BASE.reason, userId: USER }).success, false);
  assert.equal(ownershipRecoverySchema.parse({ version: 0, reason: BASE.reason, userId: USER, confirmed: true }).confirmed, true);
  assert.equal(ownershipInvitationSchema.safeParse({ ...BASE, token: 'must-never-store-client-token' }).success, false);
  assert.equal(financePermissionSchema.safeParse({ financeAuthorized: true, version: 0, reason: BASE.reason, password: 'irrelevant' }).success, false);
});
test('ownership actions reject unauthorized callers before reading or changing a business', async () => {
  let reads = 0;
  const service = createAdminBusinessAccessService({ models: { Organization: { findByPk: async () => { reads += 1; } } }, permissions: { assertInternal: async () => { throw forbidden(); } } });
  for (const work of [() => service.detail(USER, USER), () => service.invite(USER, USER, BASE), () => service.remove(USER, USER, USER, {}), () => service.recover(USER, USER, {})]) await assert.rejects(work, { code: 'FORBIDDEN' });
  assert.equal(reads, 0);
});
