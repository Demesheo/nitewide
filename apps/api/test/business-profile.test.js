const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerAccountService } = require('../src/services/customer-account-service');

function fixture(existingEmail = null) {
  const user = { id: 'user-1', isActive: true, email: 'old@example.com', displayName: 'Old Name', phone: '+14075550000', phoneVerifiedAt: new Date(),
    async update(changes) { Object.assign(this, changes); } };
  const audits = [];
  const models = { User: {
    sequelize: { transaction: async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }) },
    findByPk: async () => user,
    findOne: async ({ where }) => where.email === existingEmail ? { id: 'other-user' } : null,
  }, AuditLog: { create: async (row) => audits.push(row) } };
  return { service: createCustomerAccountService({ models }), user, audits };
}

test('business profile updates the signed-in identity, normalizes email, clears phone verification, and audits', async () => {
  const { service, user, audits } = fixture();
  const result = await service.updateIdentity(user.id, { displayName: 'New Name', email: '  NEW@Example.COM ', confirmEmail: 'new@example.com', phone: '+14075551111', confirmPhone: '+14075551111' });
  assert.equal(result.email, 'new@example.com');
  assert.equal(result.displayName, 'New Name');
  assert.equal(result.phone, '+14075551111');
  assert.equal(result.phoneVerifiedAt, null);
  assert.equal(audits[0].action, 'user.identity_updated');
});

test('business profile rejects an email belonging to another user without writing', async () => {
  const { service, user, audits } = fixture('taken@example.com');
  await assert.rejects(() => service.updateIdentity(user.id, { displayName: 'New Name', email: 'taken@example.com', confirmEmail: 'taken@example.com', phone: null, confirmPhone: null }), { code: 'EMAIL_IN_USE' });
  assert.equal(user.email, 'old@example.com');
  assert.equal(audits.length, 0);
});

test('changed email and phone both require matching confirmation before any write', async () => {
  for (const input of [
    { email: 'new@example.com', phone: '+14075550000' },
    { email: 'new@example.com', confirmEmail: 'other@example.com', phone: '+14075550000' },
    { email: 'old@example.com', phone: '+14075551111' },
    { email: 'old@example.com', phone: '+14075551111', confirmPhone: '+14075552222' },
  ]) {
    const { service, user, audits } = fixture();
    await assert.rejects(() => service.updateIdentity(user.id, { displayName: 'New Name', ...input }), { code: 'PROFILE_CONFIRMATION_MISMATCH' });
    assert.equal(user.displayName, 'Old Name');
    assert.equal(audits.length, 0);
  }
});

test('name-only edits do not require contact confirmation and phone removal requires explicit blank confirmation', async () => {
  const { service, user } = fixture();
  await service.updateIdentity(user.id, { displayName: 'New Name', email: user.email, phone: user.phone });
  assert.equal(user.displayName, 'New Name');
  await assert.rejects(() => service.updateIdentity(user.id, { displayName: 'New Name', email: user.email, phone: null }), { code: 'PROFILE_CONFIRMATION_MISMATCH' });
  await service.updateIdentity(user.id, { displayName: 'New Name', email: user.email, phone: null, confirmPhone: null });
  assert.equal(user.phone, null);
});
