const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuestlistService } = require('../src/services/guestlist-service');

function fixture(reviewScope = { canReviewAny: true, eventAffiliateIds: [] }) {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const event = { id: 'event-1', organizationId: 'org-1', status: 'published', guestlistCapacity: 20 };
  let entry;
  const auditActions = [];
  const affiliate = { id: 'affiliate-1', eventId: event.id, userId: 'promoter-1', orgAffiliateId: null, code: 'PROMOTER', status: 'active', guestlistAllocation: 20 };
  let sum = async () => 0;
  const models = {
    Event: { findByPk: async () => event },
    Organization: { findByPk: async () => ({ id: 'org-1', status: 'active' }) },
    User: { findByPk: async () => ({ isActive: true }) },
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
  const permissions = { guestlistReviewScope: async (userId, eventId, options) => {
    assert.ok(userId);
    assert.equal(eventId, event.id);
    assert.equal(options, transaction, 'review authorization shares the mutation transaction');
    return reviewScope;
  } };
  return { service: createGuestlistService({ sequelize, models, permissions }), auditActions, event, affiliate, setSum: (implementation) => { sum = implementation; } };
}

test('an unrelated referrer cannot approve or decline another guestlist pool', async () => {
  const { service, auditActions } = fixture({ canReviewAny: false, eventAffiliateIds: ['unrelated-affiliate'] });
  const { entry } = await service.request({ eventId: 'event-1', userId: 'customer-1', partySize: 2, affiliateCode: 'PROMOTER' });
  for (const decision of ['approve', 'reject']) {
    await assert.rejects(service.review({ eventId: 'event-1', entryId: entry.id, reviewedByUserId: 'unrelated-promoter', decision }), { code: 'FORBIDDEN' });
    assert.equal(entry.status, 'pending');
    assert.equal(entry.qrTokenHash, null);
  }
  assert.deepEqual(auditActions, ['guestlist.requested']);
});

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

test('revoking an approved direct entry invalidates its QR, frees its allocation, and allows later approval', async () => {
  const { service, event, auditActions, setSum } = fixture();
  const requested = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 2 });
  const approved = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'employee-1', decision: 'approve' });
  assert.ok(approved.entry.qrTokenHash);
  const revoked = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'manager-1', decision: 'cancel' });
  assert.equal(revoked.entry.status, 'rejected');
  assert.equal(revoked.entry.qrTokenHash, null);
  assert.deepEqual(auditActions, ['guestlist.requested', 'guestlist.approved', 'guestlist.approval_revoked']);
  await assert.rejects(service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'manager-1', decision: 'cancel' }), { code: 'GUESTLIST_NOT_CANCELLABLE' });
  setSum(async () => event.guestlistCapacity);
  await assert.rejects(service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'manager-1', decision: 'approve' }), { code: 'GUESTLIST_FULL' });
  assert.equal(requested.entry.status, 'rejected');
  setSum(async () => event.guestlistCapacity - requested.entry.partySize);
  const reapproved = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'manager-1', decision: 'approve' });
  assert.equal(reapproved.entry.status, 'confirmed');
  assert.notEqual(reapproved.qrToken, approved.qrToken);
  assert.deepEqual(auditActions, ['guestlist.requested', 'guestlist.approved', 'guestlist.approval_revoked', 'guestlist.approved']);
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
  const { service, event, affiliate, auditActions } = fixture({ canReviewAny: false, eventAffiliateIds: ['affiliate-1'] });
  const requested = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 1, affiliateCode: affiliate.code });
  const denied = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: affiliate.userId, decision: 'reject' });
  assert.equal(denied.entry.status, 'rejected');
  assert.equal(denied.entry.reviewedByUserId, affiliate.userId);
  assert.deepEqual(auditActions, ['guestlist.requested', 'guestlist.rejected']);
  const approved = await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: affiliate.userId, decision: 'approve' });
  assert.equal(approved.entry.status, 'confirmed');
  assert.ok(approved.entry.qrTokenHash);
  assert.deepEqual(auditActions, ['guestlist.requested', 'guestlist.rejected', 'guestlist.approved']);
});
