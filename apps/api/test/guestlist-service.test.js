const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuestlistService } = require('../src/services/guestlist-service');

function fixture(reviewScope = { canReviewAny: true, eventAffiliateIds: [] }, email = null) {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const event = { id: 'event-1', organizationId: 'org-1', title: 'Night One', startsAt: new Date(), status: 'published', guestlistCapacity: 20 };
  let entry;
  const auditActions = [];
  const auditRecords = [], passes = [], notificationRecords = [];
  let passSequence = 0;
  const affiliate = { id: 'affiliate-1', eventId: event.id, userId: 'promoter-1', orgAffiliateId: null, code: 'PROMOTER', status: 'active', guestlistAllocation: 20 };
  let sum = async () => 0;
  const models = {
    Event: { findByPk: async () => event },
    Organization: { findByPk: async () => ({ id: 'org-1', status: 'active' }) },
    User: { findByPk: async () => ({ isActive: true, email: 'guest@example.org', displayName: 'Guest' }) },
    OrganizationOwner: { findAll: async () => [] },
    EventAffiliate: { findByPk: async (id) => id === affiliate.id ? affiliate : null, findOne: async ({ where }) => where.code === affiliate.code ? affiliate : null },
    OrgAffiliate: {},
    GuestlistEntry: {
      create: async (data) => { entry = { id: 'entry-1', ...data, update: async (changes) => Object.assign(entry, changes) }; return entry; },
      findOne: async () => entry,
      sum: (...args) => sum(...args),
    },
    GuestlistPass: {
      findAll: async ({ transaction: lockedTransaction, lock }) => { assert.equal(lockedTransaction, transaction); assert.equal(lock, transaction.LOCK.UPDATE); return [...passes]; },
      bulkCreate: async (rows, { transaction: lockedTransaction }) => {
        assert.equal(lockedTransaction, transaction);
        return rows.map((row) => {
          const pass = { id: `pass-${++passSequence}`, ...row, destroy: async ({ transaction: lockedTransaction }) => {
            assert.equal(lockedTransaction, transaction); passes.splice(passes.indexOf(pass), 1);
          } };
          passes.push(pass); return pass;
        });
      },
    },
    Notification: { create: async (data) => { notificationRecords.push(data); return data; } },
    AffiliateAttribution: { create: async () => ({}) },
    AuditLog: { create: async (data) => { auditActions.push(data.action); auditRecords.push(data); return data; } },
  };
  const sequelize = { transaction: async (_options, work) => work(transaction) };
  const permissions = { guestlistReviewScope: async (userId, eventId, options) => {
    assert.ok(userId);
    assert.equal(eventId, event.id);
    assert.equal(options, transaction, 'review authorization shares the mutation transaction');
    return reviewScope;
  } };
  return { service: createGuestlistService({ sequelize, models, permissions, email }), auditActions, auditRecords, passes, notificationRecords, event, affiliate, setSum: (implementation) => { sum = implementation; } };
}

test('customer request quantities are whole numbers from one through five at the domain boundary', async () => {
  for (const partySize of [undefined, null, '2', 0, -1, 1.5, 6, 20, 21, NaN, Infinity]) {
    const { service, auditActions } = fixture();
    await assert.rejects(service.request({ eventId: 'event-1', userId: 'customer-1', partySize }), { code: 'INVALID_GUESTLIST_PARTY_SIZE', status: 422 });
    assert.deepEqual(auditActions, []);
  }
  for (const partySize of [1, 5]) {
    const { service } = fixture();
    assert.equal((await service.request({ eventId: 'event-1', userId: 'customer-1', partySize })).entry.partySize, partySize);
  }
});

test('approval adjusts five requested spots to four passes, audits both counts, and queues the approved quantity', async () => {
  const messages = [];
  const { service, auditRecords, passes, notificationRecords, event, setSum } = fixture(undefined, { enabled: true, queue: async (message) => messages.push(message) });
  event.guestlistCapacity = 4;
  setSum(async () => 0);
  const { entry } = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 5 });
  await service.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager-1', decision: 'approve', partySize: 4 });
  assert.equal(entry.partySize, 4);
  assert.equal(entry.status, 'confirmed');
  assert.deepEqual(passes.map((pass) => pass.position), [1, 2, 3, 4]);
  assert.equal(new Set(passes.map((pass) => pass.qrTokenHash)).size, 4);
  assert.deepEqual(auditRecords.at(-1).before, { status: 'pending', partySize: 5 });
  assert.deepEqual(auditRecords.at(-1).after, { status: 'confirmed', partySize: 4 });
  assert.equal(notificationRecords.at(-1).message, 'You were approved for 4 spots on the guestlist for Night One.');
  assert.equal(notificationRecords.at(-1).metadata.partySize, 4);
  assert.equal(messages.at(-1).variables.SPOTS, '4');
  assert.match(messages.at(-1).key, /^guestlist\/entry-1\/approved\/\d+$/);
});

test('approval bounds, decision bounds, and quantity-bearing reject or cancel calls fail without changes', async () => {
  const { service, event, auditActions, passes } = fixture();
  const { entry } = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 5 });
  for (const partySize of [null, '4', 0, -1, 1.5, 21, NaN, Infinity]) {
    await assert.rejects(service.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager-1', decision: 'approve', partySize }), { code: 'INVALID_GUESTLIST_PARTY_SIZE', status: 422 });
  }
  for (const decision of ['reject', 'cancel', 'invalid', undefined]) {
    await assert.rejects(service.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager-1', decision, partySize: 4 }), { code: 'INVALID_GUESTLIST_DECISION', status: 422 });
  }
  assert.equal(entry.partySize, 5); assert.equal(entry.status, 'pending'); assert.equal(entry.qrTokenHash, null);
  assert.deepEqual(auditActions, ['guestlist.requested']); assert.equal(passes.length, 0);
});

test('increased approval uses its actual quantity when checking direct and affiliate capacity', async () => {
  for (const referred of [false, true]) {
    const { service, event, affiliate, setSum, passes, auditActions } = fixture();
    const { entry } = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 1, ...(referred ? { affiliateCode: affiliate.code } : {}) });
    setSum(async () => 19);
    await assert.rejects(service.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager-1', decision: 'approve', partySize: 2 }), { code: referred ? 'AFFILIATE_GUESTLIST_FULL' : 'GUESTLIST_FULL' });
    assert.equal(entry.partySize, 1); assert.equal(entry.status, 'pending'); assert.equal(entry.qrTokenHash, null);
    assert.deepEqual(auditActions, ['guestlist.requested']); assert.equal(passes.length, 0);
    setSum(async () => 0);
    await service.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager-1', decision: 'approve', partySize: 20 });
    assert.equal(entry.partySize, 20); assert.equal(passes.length, 20);
  }
});

test('legacy pending quantities are preserved and can be approved without a quantity override', async () => {
  const { service, event, auditRecords, passes } = fixture();
  const { entry } = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 5 });
  entry.partySize = 20;
  await service.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager-1', decision: 'approve' });
  assert.equal(entry.partySize, 20); assert.equal(passes.length, 20);
  assert.equal(auditRecords.at(-1).before.partySize, 20);
});

test('revoked approvals can shrink and increase the unused pass set on reapproval', async () => {
  const { service, event, passes } = fixture();
  const { entry } = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 5 });
  const review = (decision, partySize) => service.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager-1', decision, ...(partySize === undefined ? {} : { partySize }) });
  await review('approve');
  const firstId = passes[0].id;
  await review('cancel'); await review('approve', 1);
  assert.equal(entry.partySize, 1); assert.equal(passes.length, 1); assert.equal(passes[0].id, firstId);
  await review('cancel'); await review('approve', 4);
  assert.equal(entry.partySize, 4); assert.deepEqual(passes.map((pass) => pass.position), [1, 2, 3, 4]);
});

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

test('partially admitted guests cannot be revoked even without a check-in timestamp', async () => {
  const { service, event, auditActions } = fixture();
  const requested = await service.request({ eventId: event.id, userId: 'customer-1', partySize: 2 });
  await service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'employee-1', decision: 'approve' });
  requested.entry.checkedInSpots = 1;
  requested.entry.checkedInAt = null;
  await assert.rejects(service.review({ eventId: event.id, entryId: requested.entry.id, reviewedByUserId: 'manager-1', decision: 'cancel' }), { code: 'GUESTLIST_NOT_CANCELLABLE' });
  assert.equal(requested.entry.status, 'confirmed');
  assert.deepEqual(auditActions, ['guestlist.requested', 'guestlist.approved']);
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
