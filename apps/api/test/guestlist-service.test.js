const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuestlistService } = require('../src/services/guestlist-service');

function fixture() {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const event = { id: 'event-1', organizationId: 'org-1', status: 'published', guestlistCapacity: 20 };
  let entry;
  const auditActions = [];
  const models = {
    Event: { findByPk: async () => event },
    EventAffiliate: { findByPk: async () => null },
    OrgAffiliate: {},
    GuestlistEntry: {
      create: async (data) => { entry = { id: 'entry-1', ...data, update: async (changes) => Object.assign(entry, changes) }; return entry; },
      findOne: async () => entry,
      sum: async () => 0,
    },
    AffiliateAttribution: { create: async () => ({}) },
    AuditLog: { create: async (data) => { auditActions.push(data.action); return data; } },
  };
  const sequelize = { transaction: async (_options, work) => work(transaction) };
  return { service: createGuestlistService({ sequelize, models }), auditActions };
}

test('a customer creates a pending guestlist request without receiving a QR token', async () => {
  const { service, auditActions } = fixture();
  const result = await service.request({ eventId: 'event-1', userId: 'customer-1', partySize: 2 });
  assert.equal(result.entry.status, 'pending');
  assert.equal(result.entry.qrTokenHash, null);
  assert.equal(result.qrToken, undefined);
  assert.equal(result.requiresApproval, true);
  assert.deepEqual(auditActions, ['guestlist.requested']);
});

test('approval confirms the request and issues its QR credential', async () => {
  const { service, auditActions } = fixture();
  const requested = await service.request({ eventId: 'event-1', userId: 'customer-1', partySize: 2 });
  const approved = await service.review({ eventId: 'event-1', entryId: requested.entry.id, reviewedByUserId: 'employee-1', decision: 'approve' });
  assert.equal(approved.entry.status, 'confirmed');
  assert.equal(approved.entry.reviewedByUserId, 'employee-1');
  assert.equal(typeof approved.qrToken, 'string');
  assert.equal(approved.qrToken.length > 20, true);
  assert.deepEqual(auditActions, ['guestlist.requested', 'guestlist.approved']);
});
