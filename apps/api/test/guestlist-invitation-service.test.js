const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuestlistInvitationService, invitationsOpen } = require('../src/services/guestlist-invitation-service');

const now = new Date('2026-09-23T12:00:00Z');
const future = new Date('2026-09-24T12:00:00Z');

test('guest invitations are open only for unfinished published events', () => {
  assert.equal(invitationsOpen({ status: 'published', endsAt: future }, now), true);
  for (const status of ['draft', 'cancelled', 'completed']) {
    assert.equal(invitationsOpen({ status, endsAt: future }, now), false);
  }
  assert.equal(invitationsOpen({ status: 'published', endsAt: now }, now), false);
});

test('draft events advertise no invite pools and reject invitations before writing', async () => {
  const draft = { id: 'draft-event', status: 'draft', endsAt: future };
  let wrote = false;
  const service = createGuestlistInvitationService({
    sequelize: { transaction: async () => { wrote = true; } },
    models: { EventAffiliate: { findAll: async () => { throw new Error('Closed event should not load invite affiliates'); } } },
    permissions: { guestlistReviewScope: async () => ({ event: draft, canReviewAny: true, eventAffiliateIds: [] }) },
    now: () => now,
  });
  assert.deepEqual(await service.pools('owner', draft.id), { direct: false, own: [], open: false });
  await assert.rejects(() => service.invite('owner', draft.id, { pool: 'direct', email: 'guest@example.com', partySize: 1 }), { code: 'GUESTLIST_CLOSED' });
  assert.equal(wrote, false);
});
