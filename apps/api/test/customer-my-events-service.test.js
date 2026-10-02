const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessReadService } = require('../src/services/business-read-service');

test('Customer read override leaves the default Business internal report permission unchanged', async () => {
  const user = { id: 'staff', isActive: true, lifecycleState: 'active', onboardingPending: false,
    isInternalAdmin: true, internalAdminRole: 'read_only' };
  const models = {
    User: { findByPk: async () => user },
    OrganizationOwner: { findAll: async () => [] },
  };
  const business = createBusinessReadService({ models });
  const customer = createBusinessReadService({ models, internalReadPermission: 'events.manage' });
  assert.equal((await business.actor(user.id)).isAdmin, true);
  assert.equal((await customer.actor(user.id)).isAdmin, false);
  user.internalAdminRole = 'operations';
  assert.equal((await business.actor(user.id)).isAdmin, true);
  assert.equal((await customer.actor(user.id)).isAdmin, true);
});
