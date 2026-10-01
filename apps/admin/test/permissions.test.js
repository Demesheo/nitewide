import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAdminPermission } from '../src/lib/permissions.js';
const user = (internalAdminRole) => ({ isInternalAdmin: true, isActive: true, lifecycleState: 'active', internalAdminRole });
test('staff roles keep management, support and reports separate', () => {
  assert.equal(hasAdminPermission(user('support'), 'support.manage'), true);
  assert.equal(hasAdminPermission(user('support'), 'reports.view'), false);
  assert.equal(hasAdminPermission(user('operations'), 'events.manage'), true);
  assert.equal(hasAdminPermission(user('operations'), 'support.manage'), false);
  assert.equal(hasAdminPermission(user('read_only'), 'reports.view'), true);
  assert.equal(hasAdminPermission(user('read_only'), 'businesses.manage'), false);
  assert.equal(hasAdminPermission(user('platform_owner'), 'businesses.manage'), true);
});
test('inactive, unverified setup and unknown roles cannot gain UI write access', () => {
  assert.equal(hasAdminPermission({ ...user('platform_owner'), isActive: false }, 'support.manage'), false);
  assert.equal(hasAdminPermission({ ...user('platform_owner'), onboardingPending: true }, 'support.manage'), false);
  assert.equal(hasAdminPermission(user('unknown'), 'directory.view'), false);
  assert.equal(hasAdminPermission({ isInternalAdmin: false }, 'directory.view'), false);
});
