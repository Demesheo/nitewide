const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuestlistInvitationService, invitationsOpen } = require('../src/services/guestlist-invitation-service');
const crypto = require('node:crypto');

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
    sequelize: { transaction: async (_options, run) => run({ LOCK: { UPDATE: 'UPDATE' } }) },
    models: { Event: { findByPk: async () => draft },
      GuestlistInvitation: { create: async () => { wrote = true; } },
      GuestlistEntry: { create: async () => { wrote = true; } },
      EventAffiliate: { findAll: async () => { throw new Error('Closed event should not load invite affiliates'); } } },
    permissions: { guestlistReviewScope: async () => ({ event: draft, canReviewAny: true, eventAffiliateIds: [] }) },
    now: () => now,
  });
  assert.deepEqual(await service.pools('owner', draft.id), { direct: false, own: [], open: false });
  await assert.rejects(() => service.invite('owner', draft.id, { pool: 'direct', email: 'guest@example.com', partySize: 1 }), { code: 'GUESTLIST_CLOSED' });
  assert.equal(wrote, false);
});

function claimFixture({ eventState = 'active', inviterActive = true, inviterMembership = true } = {}) {
  const token = 'guestlist-claim-token';
  const invitation = {
    id: 'invite', eventId: 'event', invitedByUserId: 'inviter', eventAffiliateId: null,
    email: 'guest@example.com', status: 'pending', partySize: 1, expiresAt: future,
  };
  const event = { id: 'event', organizationId: 'org', status: 'published', lifecycleState: eventState, endsAt: future, guestlistCapacity: 2 };
  let created = 0;
  const models = {
    GuestlistInvitation: { findOne: async ({ where }) => where.id || where.tokenHash === crypto.createHash('sha256').update(token).digest('hex') ? invitation : null },
    Event: { findByPk: async () => event },
    User: { findByPk: async (id) => id === 'guest'
      ? { id, email: 'guest@example.com', isActive: true, lifecycleState: 'active', onboardingPending: false }
      : { id, email: 'inviter@example.com', isActive: inviterActive, lifecycleState: inviterActive ? 'active' : 'archived', onboardingPending: false } },
    Organization: { findByPk: async () => ({ id: 'org', status: 'active', lifecycleState: 'active' }) },
    OrganizationOwner: { findOne: async () => inviterMembership ? { id: 'membership', userId: 'inviter', role: 'admin', lifecycleState: 'active' } : null },
    OrganizationEmployee: { findOne: async () => null },
    OrgAffiliate: { findOne: async () => null },
    GuestlistEntry: { findOne: async () => null, sum: async () => 0, create: async () => { created += 1; } },
  };
  const service = createGuestlistInvitationService({ sequelize: { transaction: async (_options, run) => run({ LOCK: { UPDATE: true } }) }, models, permissions: {} , now: () => now });
  return { service, token, created: () => created };
}

test('claim never confirms a pending direct invitation for an inactive event', async () => {
  const fixture = claimFixture({ eventState: 'archived' });
  const result = await fixture.service.claim(fixture.token, 'guest');
  assert.deepEqual(result, { status: 'event_closed', eventId: 'event' });
  assert.equal(fixture.created(), 0);
});

test('claim never confirms a pending direct invitation after its inviter loses access', async () => {
  const fixture = claimFixture({ inviterMembership: false });
  const result = await fixture.service.claim(fixture.token, 'guest');
  assert.deepEqual(result, { status: 'unavailable', eventId: 'event' });
  assert.equal(fixture.created(), 0);
});
