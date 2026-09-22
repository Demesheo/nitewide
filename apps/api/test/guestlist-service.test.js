const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuestlistService } = require('../src/services/guestlist-service');

function fixture() {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const event = { id: 'event-1', organizationId: 'org-1', status: 'published', guestlistCapacity: 20 };
  let entry;
  const auditActions = [];
  const affiliate = { id: 'affiliate-1', eventId: event.id, userId: 'promoter-1', orgAffiliateId: null, code: 'PROMOTER', status: 'active', guestlistAllocation: 20 };
  let sum = async () => 0;
  const models = {
    Event: { findByPk: async () => event },
    EventAffiliate: { findByPk: async (id) => id === affiliate.id ? affiliate : null, findOne: async ({ where }) => where.code === affiliate.code ? affiliate : null },
    OrgAffiliate: {},
    GuestlistEntry: {
      create: async (data) => { entry = { id: 'entry-1', ...data, update: async (changes) => Object.assign(entry, changes) }; return entry; },
      findOne: async () => entry,
      sum: (...args) => sum(...args),
    },
    AffiliateAttribution: { create: async () => ({}) },
    AuditLog: { create: async (data) => { auditActions.push(data.action); return data; } },
  };
  const sequelize = { transaction: async (_options, work) => work(transaction) };
  return { service: createGuestlistService({ sequelize, models }), auditActions, event, affiliate, setSum: (implementation) => { sum = implementation; } };
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

test('a promoter allocation is independent from the direct venue guestlist capacity', async () => {
  const { service, event, affiliate, setSum } = fixture();
  event.guestlistCapacity = 50;
  affiliate.guestlistAllocation = 20;
  setSum(async (_field, { where }) => {
    if (where.eventAffiliateId === affiliate.id) return 19;
    if (where.eventAffiliateId === null) return 50;
    return 89;
  });
  const requested = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 1, affiliateCode: affiliate.code });
  const approved = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'employee-1', decision: 'approve' });
  assert.equal(approved.entry.status, 'confirmed');
});

test('direct approvals only consume the venue guestlist pool', async () => {
  const { service, event, setSum } = fixture();
  event.guestlistCapacity = 50;
  setSum(async (_field, { where }) => where.eventAffiliateId === null ? 49 : 40);
  const requested = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 1 });
  const approved = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'employee-1', decision: 'approve' });
  assert.equal(approved.entry.status, 'confirmed');
});

test('cancelling an approved direct entry invalidates its QR and frees its allocation', async () => {
  const { service, event, auditActions } = fixture();
  const requested = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 2 });
  const approved = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'employee-1', decision: 'approve' });
  assert.ok(approved.entry.qrTokenHash);
  const cancelled = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'manager-1', decision: 'cancel' });
  assert.equal(cancelled.entry.status, 'cancelled');
  assert.equal(cancelled.entry.qrTokenHash, null);
  assert.deepEqual(auditActions, ['guestlist.requested', 'guestlist.approved', 'guestlist.cancelled']);
  assert.equal(cancelled.entry.status === 'confirmed' || cancelled.entry.status === 'checked_in', false);
  await assert.rejects(service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'manager-1', decision: 'cancel' }), { code: 'GUESTLIST_NOT_CANCELLABLE' });
});

test('checked-in guestlist entries cannot be cancelled', async () => {
  const { service, event } = fixture();
  const requested = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 1 });
  await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'employee-1', decision: 'approve' });
  requested.entry.status = 'checked_in';
  requested.entry.checkedInAt = new Date();
  await assert.rejects(service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'manager-1', decision: 'cancel' }), { code: 'GUESTLIST_NOT_CANCELLABLE' });
});

test('a referred guestlist request can be declined by its referrer', async () => {
  const { service, event, affiliate, auditActions } = fixture();
  const requested = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 1, affiliateCode: affiliate.code });
  const denied = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: affiliate.userId, decision: 'reject' });
  assert.equal(denied.entry.status, 'rejected');
  assert.equal(denied.entry.reviewedByUserId, affiliate.userId);
  assert.deepEqual(auditActions, ['guestlist.requested', 'guestlist.rejected']);
});
