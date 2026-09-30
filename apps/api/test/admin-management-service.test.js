const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminManagementService } = require('../src/services/admin-management-service');

const ADMIN = '10000000-0000-4000-8000-000000000001';
const USER = '20000000-0000-4000-8000-000000000002';
const ORG = '30000000-0000-4000-8000-000000000003';
const EVENT = '40000000-0000-4000-8000-000000000004';
const OFFERING = '50000000-0000-4000-8000-000000000005';
const WHY = 'Required administrative maintenance';

function fixture({ deny = false, rows = {}, related = {}, ownerCount = 2, guestlistService, guestlistInvitationService, onboardingService } = {}) {
  const calls = [];
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const data = new Map(Object.entries(rows));
  const models = {};
  const define = (name, table, rawAttributes = {}) => {
    const records = data.get(name) || [];
    const model = {
      rawAttributes: { id: {}, createdAt: {}, updatedAt: {}, displayName: {}, email: {}, name: {}, slug: {}, description: {}, locationId: {}, title: {}, status: {}, lifecycleState: {}, startsAt: {}, endsAt: {}, capacity: {}, guestlistCapacity: {}, isDiscoverable: {}, version: {}, eventId: {}, userId: {}, orderId: {}, orderItemId: {}, holderUserId: {}, amountCents: {}, totalCents: {}, currency: {}, paidAt: {}, phone: {}, isActive: {}, isInternalAdmin: {}, creatorUserId: {}, organizationId: {}, priceCents: {}, quantitySold: {}, passwordHash: {}, passwordSalt: {}, templateAlias: {}, attemptCount: {}, nextAttemptAt: {}, expiresAt: {}, recipientEmail: {}, encryptedVariables: {}, providerMessageId: {}, lastError: {}, ...rawAttributes },
      getTableName: () => table,
      sequelize: { transaction: async (options, run) => {
        if (typeof options === 'function') run = options;
        calls.push(['transaction', name]);
        return run(transaction);
      } },
      findByPk: async (id, options = {}) => {
        calls.push(['findByPk', name, id, options]);
        return records.find((record) => record.id === id) || null;
      },
      findAll: async ({ where = {} } = {}) => {
        calls.push(['findAll', name, where]);
        return records.filter((record) => Object.entries(where).every(([key, value]) => record[key] === value));
      },
      findAndCountAll: async (options) => { calls.push(['findAndCountAll', name, options]); return { count: records.length, rows: records }; },
      count: async ({ where = {} } = {}) => {
        calls.push(['count', name, where]);
        if (name === 'User' && where.isInternalAdmin && where.isActive) return ownerCount;
        const fk = Object.keys(where).find((key) => !['status', 'role', 'isInternalAdmin', 'isActive'].includes(key));
        return fk ? (related[`${name}.${fk}.${where[fk]}`] || 0) : 0;
      },
      create: async (values, options) => {
        calls.push(['create', name, values, options]);
        const record = { id: values.id || `${name}-new`, ...values, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), toJSON() { return { ...this }; }, update: async (changes) => { Object.assign(record, changes); calls.push(['update', name, changes]); return record; }, destroy: async () => { calls.push(['destroy', name, record.id]); } };
        records.push(record);
        return record;
      },
      destroy: async ({ where = {}, transaction: tx } = {}) => { calls.push(['destroy', name, where, tx]); return 1; },
      update: async (values, { where = {}, transaction: tx } = {}) => {
        calls.push(['updateMany', name, values, where, tx]);
        const matched = records.filter((record) => Object.entries(where).every(([key, value]) => record[key] === value));
        for (const record of matched) Object.assign(record, values);
        return [matched.length || 1];
      },
    };
    models[name] = model;
    return model;
  };
  const fk = (model, key, table, onDelete) => ({ [key]: { references: { model: table }, onDelete } });
  const userModel = define('User', 'users', { passwordHash: {}, email: {} });
  userModel.sequelize = { transaction: async (options, run) => { if (typeof options === 'function') run = options; calls.push(['transaction', 'User']); return run(transaction); } };
  define('UserCredential', 'user_credentials', fk('UserCredential', 'userId', 'users', 'CASCADE'));
  define('UserActionToken', 'user_action_tokens', fk('UserActionToken', 'userId', 'users', 'CASCADE'));
  define('Notification', 'notifications', fk('Notification', 'userId', 'users', 'CASCADE'));
  define('OrganizationOwner', 'organization_owners', { ...fk('OrganizationOwner', 'organizationId', 'organizations', 'CASCADE'), ...fk('OrganizationOwner', 'userId', 'users', 'CASCADE') });
  define('OrganizationEmployee', 'organization_employees', { ...fk('OrganizationEmployee', 'organizationId', 'organizations', 'CASCADE'), ...fk('OrganizationEmployee', 'userId', 'users', 'CASCADE') });
  define('Organization', 'organizations', {});
  define('Location', 'locations', {});
  define('Event', 'events', { creatorUserId: { references: { model: 'users' }, onDelete: 'RESTRICT' }, organizationId: { references: { model: 'organizations' }, onDelete: 'SET NULL' }, locationId: { references: { model: 'locations' }, onDelete: 'SET NULL' } });
  define('Offering', 'offerings', { eventId: { references: { model: 'events' }, onDelete: 'CASCADE' }, ...fk('Offering', 'releaseAfterOfferingId', 'offerings', 'SET NULL') });
  define('Order', 'orders', { buyerUserId: { references: { model: 'users' }, onDelete: 'RESTRICT' }, eventId: { references: { model: 'events' }, onDelete: 'RESTRICT' } });
  define('OrderItem', 'order_items', fk('Ticket', 'orderItemId', 'order_items', 'RESTRICT'));
  define('Payment', 'payments');
  define('Ticket', 'tickets', { holderUserId: { references: { model: 'users' }, onDelete: 'RESTRICT' }, eventId: { references: { model: 'events' }, onDelete: 'RESTRICT' }, orderItemId: { references: { model: 'order_items' }, onDelete: 'RESTRICT' } });
  define('GuestlistEntry', 'guestlist_entries', { eventId: { references: { model: 'events' }, onDelete: 'CASCADE' }, userId: { references: { model: 'users' }, onDelete: 'RESTRICT' } });
  define('CheckIn', 'check_ins');
  define('AuditLog', 'audit_logs');
  define('Boost', 'boosts');
  define('TeamInvitation', 'team_invitations');
  define('GuestlistInvitation', 'guestlist_invitations');
  define('MediaAsset', 'media_assets');
  define('EventAffiliate', 'event_affiliates');
  define('OrgAffiliate', 'org_affiliates');
  define('AffiliateAttribution', 'affiliate_attributions');
  define('EmailOutbox', 'email_outbox');
  const permissions = { assertInternal: async () => { calls.push(['authorize']); if (deny) { const error = new Error('forbidden'); error.code = 'FORBIDDEN'; throw error; } } };
  return { service: createAdminManagementService({ models, permissions, guestlistService, guestlistInvitationService, onboardingService, email: { enabled: false } }), models, calls, transaction };
}

const record = (id, values = {}) => ({ id, createdAt: '2026-09-29T12:00:00.000Z', updatedAt: '2026-09-29T12:00:00.000Z', ...values, toJSON() { return { ...this }; }, update: async function update(changes) { Object.assign(this, changes); return this; }, destroy: async function destroy() { this.destroyed = true; } });

test('management metadata and list are internal-only and never expose credential fields', async () => {
  const denied = fixture({ deny: true });
  await assert.rejects(() => denied.service.metadata(USER), { code: 'FORBIDDEN' });
  await assert.rejects(() => denied.service.list(USER, 'users', {}), { code: 'FORBIDDEN' });
  assert.deepEqual(denied.calls, [['authorize'], ['authorize']]);

  const rows = [record(USER, { displayName: 'Test User', email: 'user@example.test', passwordHash: 'do-not-return', passwordSalt: 'do-not-return' })];
  const allowed = fixture({ rows: { User: rows } });
  const result = await allowed.service.list(ADMIN, 'users', {});
  assert.equal(result.items[0].email, 'user@example.test');
  assert.equal('passwordHash' in result.items[0], false);
  assert.equal('passwordSalt' in result.items[0], false);
});

test('management pages apply status and allowlisted sort before returning records', async () => {
  const context = fixture({ rows: { User: [record(USER, { displayName: 'Test User', isActive: true })] } });
  const result = await context.service.list(ADMIN, 'users', { page: 2, pageSize: 25, status: 'active', sort: 'displayName', direction: 'asc' });
  const options = context.calls.find((call) => call[0] === 'findAndCountAll' && call[1] === 'User')[2];
  assert.equal(result.page, 2);
  assert.equal(result.total, 1);
  assert.equal(result.hasMore, false);
  assert.equal(options.where.isActive, true);
  assert.equal(options.where.lifecycleState, 'active');
  assert.equal(options.limit, 25);
  assert.equal(options.offset, 25);
  assert.deepEqual(options.order, [['displayName', 'ASC'], ['id', 'ASC']]);
  await assert.rejects(() => context.service.list(ADMIN, 'users', { sort: 'passwordHash' }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(() => context.service.list(ADMIN, 'users', { status: 'paid' }), { code: 'VALIDATION_ERROR' });
  await context.service.list(ADMIN, 'users', { status: 'archived' });
  const archived = context.calls.filter((call) => call[0] === 'findAndCountAll' && call[1] === 'User').at(-1)[2];
  assert.equal(archived.where.lifecycleState, 'archived');
});

test('detail, create, and lifecycle actions authorize before touching records; hard-delete APIs are absent', async () => {
  const denied = fixture({ deny: true });
  await assert.rejects(() => denied.service.detail(USER, 'users', USER), { code: 'FORBIDDEN' });
  await assert.rejects(() => denied.service.create(USER, 'users', {}), { code: 'FORBIDDEN' });
  await assert.rejects(() => denied.service.action(USER, 'events', EVENT, 'suspend', { reason: WHY, version: 0 }), { code: 'FORBIDDEN' });
  assert.equal(denied.service.deletePreview, undefined);
  assert.equal(typeof denied.service.action, 'function');
  await assert.rejects(() => denied.service.remove(USER, 'users', USER, { reason: WHY }), { code: 'FORBIDDEN' });
  assert.deepEqual(denied.calls, [['authorize'], ['authorize'], ['authorize'], ['authorize']]);
});

test('invalid resource and malformed IDs fail closed without database writes', async () => {
  const context = fixture();
  await assert.rejects(() => context.service.list(ADMIN, 'user_credentials', {}), { code: 'NOT_FOUND' });
  await assert.rejects(() => context.service.detail(ADMIN, 'users', 'not-a-uuid'));
  assert.equal(context.calls.some(([kind]) => kind === 'create' || kind === 'destroy'), false);
});

test('user creation delegates to onboarding and never accepts or stores an initial password', async () => {
  const forwarded = [];
  const context = fixture({ onboardingService: { create: async (actor, input) => { forwarded.push({ actor, input }); return { id: 'invite-id', userId: USER, accountMode: 'new', delivery: 'unavailable' }; } } });
  await assert.rejects(() => context.service.create(ADMIN, 'users', { displayName: 'New User', email: 'new@example.test', password: 'long-enough-password' }));
  await assert.rejects(() => context.service.create(ADMIN, 'users', { displayName: 'New User', email: 'new@example.test', reason: WHY, passwordHash: 'attacker-value' }));
  const result = await context.service.create(ADMIN, 'users', { displayName: 'New User', email: 'new@example.test', reason: WHY });
  assert.equal(result.delivery, 'unavailable');
  assert.deepEqual(forwarded, [{ actor: ADMIN, input: { kind: 'user', recipient: { displayName: 'New User', email: 'new@example.test' }, isInternalAdmin: false, reason: WHY } }]);
  assert.equal('password' in result, false);
  assert.equal(context.calls.some(([kind, model]) => kind === 'create' && ['User', 'UserCredential'].includes(model)), false);
});

test('organization creation validates the owner reference and writes membership plus reasoned audit atomically', async () => {
  const owner = record(USER, { displayName: 'Org Owner', email: 'owner@example.test' });
  const context = fixture({ rows: { User: [owner] } });
  const input = { name: 'Test Venue', slug: 'test-venue', ownerUserId: USER, reason: WHY };
  await assert.rejects(() => context.service.create(ADMIN, 'organizations', { ...input, ownerUserId: EVENT }), { code: 'NOT_FOUND' });
  assert.equal(context.calls.some(([kind, model]) => kind === 'create' && model === 'Organization'), false);
  const result = await context.service.create(ADMIN, 'organizations', input);
  assert.equal(result.name, 'Test Venue');
  assert.equal(context.calls.some(([kind, model]) => kind === 'create' && model === 'OrganizationOwner'), true);
  assert.equal(context.calls.some(([kind, model]) => kind === 'create' && model === 'AuditLog'), true);
});

test('event creation cannot bypass the saved organization-location requirement', async () => {
  const user = record(USER);
  const organization = record(ORG, { locationId: null });
  const context = fixture({ rows: { User: [user], Organization: [organization] } });
  await assert.rejects(() => context.service.create(ADMIN, 'events', {
    title: 'New Test Event', slug: 'new-test-event', creatorUserId: USER, organizationId: ORG,
    startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T04:00:00Z', category: 'music', reason: WHY,
  }), { code: 'ORGANIZATION_LOCATION_REQUIRED' });
  assert.equal(context.calls.some(([kind, model]) => kind === 'create' && model === 'Event'), false);
});

test('lifecycle transitions require a reason and version, retain domain status, and emit audit records', async () => {
  const target = record(USER, { isInternalAdmin: false, isActive: true, lifecycleState: 'active', version: 0 });
  const event = record(EVENT, { creatorUserId: ADMIN, status: 'draft', lifecycleState: 'active', version: 0, startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T04:00:00Z' });
  const context = fixture({ rows: { User: [target, record(ADMIN, { isInternalAdmin: true, isActive: true })], Event: [event] } });
  await assert.rejects(() => context.service.action(ADMIN, 'users', USER, 'suspend', { reason: WHY }));
  await context.service.action(ADMIN, 'users', USER, 'suspend', { reason: WHY, version: 0 });
  assert.equal(target.lifecycleState, 'suspended');
  assert.equal(target.destroyed, undefined, 'suspension retains the account record');
  assert.equal(context.calls.some(([kind, model]) => kind === 'create' && model === 'AuditLog'), true);
  await assert.rejects(() => context.service.action(ADMIN, 'users', ADMIN, 'suspend', { reason: WHY, version: 0 }), { code: 'SELF_ADMIN_LOCKOUT' });
  const suspended = await context.service.action(ADMIN, 'events', EVENT, 'suspend', { reason: WHY, version: 0 });
  assert.equal(suspended.lifecycleState, 'suspended');
  assert.equal(event.status, 'draft', 'lifecycle suspension does not cancel or publish the event');
  const restored = await context.service.action(ADMIN, 'events', EVENT, 'restore', { reason: WHY, version: suspended.version });
  assert.equal(restored.lifecycleState, 'active');
  assert.equal(restored.status, 'draft', 'restoration does not rewrite domain status');
});

test('last active internal administrator cannot be suspended or archived', async () => {
  const adminRecord = record(USER, { isInternalAdmin: true, isActive: true, lifecycleState: 'active', version: 0 });
  const context = fixture({ rows: { User: [adminRecord] }, ownerCount: 1 });
  await assert.rejects(() => context.service.action(ADMIN, 'users', USER, 'suspend', { reason: WHY, version: 0 }), { code: 'LAST_ADMIN' });
  const internal = fixture({ rows: { User: [record(USER, { isInternalAdmin: true, isActive: true, lifecycleState: 'active', version: 0 })] }, ownerCount: 1 });
  await assert.rejects(() => internal.service.action(ADMIN, 'users', USER, 'archive', { reason: WHY, version: 0 }), { code: 'LAST_ADMIN' });
});

test('ticket voiding retains the ticket and refuses admission history', async () => {
  const ticket = record(OFFERING, { status: 'valid', eventId: EVENT, version: 0 });
  const context = fixture({ rows: { Ticket: [ticket] } });
  const voided = await context.service.action(ADMIN, 'tickets', OFFERING, 'void', { reason: WHY });
  assert.equal(ticket.status, 'void');
  assert.equal(voided.status, 'void');
  assert.equal(ticket.destroyed, undefined);
  const checkedIn = record(EVENT, { status: 'valid' });
  const rejected = fixture({ rows: { Ticket: [checkedIn] }, related: { [`CheckIn.ticketId.${EVENT}`]: 1 } });
  await assert.rejects(() => rejected.service.action(ADMIN, 'tickets', EVENT, 'void', { reason: WHY }), { code: 'TICKET_ADMISSION_HISTORY' });
  assert.equal(rejected.calls.some(([kind, model]) => kind === 'create' && model === 'AuditLog'), false);
});

test('guestlist create/review dispatches through admission workflow and carries audit reason in the same transaction', async () => {
  const entry = record(OFFERING, { eventId: EVENT, userId: USER, partySize: 2, status: 'pending', reviewedAt: null, checkedInAt: null });
  const calls = [];
  const guestlistService = {
    request: async (input, context) => {
      calls.push(['request', input]);
      await context.onCreated(entry, record(EVENT, { organizationId: ORG }), { id: 'same-db-transaction' });
      return { entry, requiresApproval: true };
    },
    review: async (input, context) => {
      calls.push(['review', input]);
      entry.status = input.decision === 'approve' ? 'confirmed' : input.decision === 'cancel' ? 'rejected' : 'rejected';
      await context.onReviewed(entry, record(EVENT, { organizationId: ORG, status: 'published', endsAt: '2030-01-01T04:00:00Z' }), { id: 'same-db-transaction' });
      return { entry, qrToken: input.decision === 'approve' ? 'private-qr-token' : null };
    },
  };
  const context = fixture({ rows: { GuestlistEntry: [entry], Event: [record(EVENT, { organizationId: ORG, status: 'published', title: 'Live event' })], User: [record(USER)] }, guestlistService });
  const created = await context.service.create(ADMIN, 'guestlist', { eventId: EVENT, userId: USER, partySize: 2, reason: WHY });
  assert.equal(created.status, 'pending');
  assert.deepEqual(calls[0], ['request', { eventId: EVENT, userId: USER, partySize: 2, affiliateCode: undefined }]);
  const approved = await context.service.action(ADMIN, 'guestlist', OFFERING, 'approve', { reason: WHY });
  assert.equal(approved.status, 'confirmed');
  assert.equal(calls[1][1].decision, 'approve');
  assert.equal(calls[1][1].note, WHY);
  const auditCall = context.calls.find(([kind, model]) => kind === 'create' && model === 'AuditLog');
  assert.equal(auditCall[2].after.adminReason, WHY);
  assert.equal(JSON.stringify(auditCall[2]).includes('private-qr-token'), false);
});

test('guestlist hard deletion is disabled and checked-in admissions cannot be cancelled', async () => {
  const reviewed = record(OFFERING, { status: 'confirmed', reviewedAt: '2026-09-28T10:00:00Z', checkedInAt: null });
  const context = fixture({ rows: { GuestlistEntry: [reviewed] } });
  await assert.rejects(() => context.service.remove(ADMIN, 'guestlist', OFFERING, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
  assert.equal(reviewed.destroyed, undefined);

  const checkedIn = record(EVENT, { status: 'checked_in', reviewedAt: '2026-09-28T10:00:00Z', checkedInAt: '2026-09-28T11:00:00Z' });
  const admitted = fixture({ rows: { GuestlistEntry: [checkedIn] }, guestlistService: {
    request: async () => ({}),
    review: async () => { const error = new Error('Only an approved, unused guestlist entry can have its approval revoked'); error.code = 'GUESTLIST_NOT_CANCELLABLE'; throw error; },
  } });
  await assert.rejects(() => admitted.service.action(ADMIN, 'guestlist', EVENT, 'cancel', { reason: WHY }), { code: 'GUESTLIST_NOT_CANCELLABLE' });
});

test('hard-delete attempts never remove financial history, even when a user has orders', async () => {
  const user = record(USER, { displayName: 'User', email: 'user@example.test' });
  const context = fixture({ rows: { User: [user] }, related: { [`Order.buyerUserId.${USER}`]: 1 } });
  await assert.rejects(() => context.service.remove(ADMIN, 'users', USER, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
  assert.equal(user.destroyed, undefined);
});

test('a user with only security children is still retained by the admin surface', async () => {
  const target = record(USER, { displayName: 'No-history user', email: 'clean@example.test' });
  const context = fixture({
    rows: { User: [target] },
    related: { [`UserCredential.userId.${USER}`]: 1, [`UserActionToken.userId.${USER}`]: 2, [`Notification.userId.${USER}`]: 1 },
  });
  await assert.rejects(() => context.service.remove(ADMIN, 'users', USER, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
  assert.equal(target.destroyed, undefined);
  assert.equal(context.calls.some(([kind]) => kind === 'destroy'), false);
});

test('user and sole-owner records remain unchanged by hard-delete requests', async () => {
  const target = record(USER, { displayName: 'History user', email: 'history@example.test' });
  const context = fixture({ rows: { User: [target] }, related: { [`Order.buyerUserId.${USER}`]: 1 } });
  await assert.rejects(() => context.service.remove(ADMIN, 'users', USER, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
  assert.equal(target.destroyed, undefined);

  const lastOwner = record(OFFERING, { organizationId: ORG, userId: USER, role: 'owner' });
  const sole = fixture({ rows: { OrganizationOwner: [lastOwner] }, related: { [`OrganizationOwner.organizationId.${ORG}`]: 1 } });
  await assert.rejects(() => sole.service.remove(ADMIN, 'owners', OFFERING, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
  assert.equal(lastOwner.destroyed, undefined);
});

test('self-administrator lifecycle changes remain protected', async () => {
  const self = record(ADMIN, { isInternalAdmin: true, isActive: true });
  const selfContext = fixture({ rows: { User: [self] } });
  await assert.rejects(() => selfContext.service.action(ADMIN, 'users', ADMIN, 'suspend', { reason: WHY, version: 0 }), { code: 'SELF_ADMIN_LOCKOUT' });
});

test('organization records cannot be hard deleted through management', async () => {
  const org = record(ORG, { name: 'Disposable org', status: 'active' });
  const owner = record(USER, { organizationId: ORG, userId: ADMIN, role: 'owner' });
  const empty = fixture({ rows: { Organization: [org], OrganizationOwner: [owner] }, related: { [`OrganizationOwner.organizationId.${ORG}`]: 1 } });
  await assert.rejects(() => empty.service.remove(ADMIN, 'organizations', ORG, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
  assert.equal(org.destroyed, undefined);
  assert.equal(owner.destroyed, undefined);

  const withEvent = fixture({ rows: { Organization: [record(ORG)], Event: [record(EVENT, { organizationId: ORG })] }, related: { [`Event.organizationId.${ORG}`]: 1 } });
  await assert.rejects(() => withEvent.service.remove(ADMIN, 'organizations', ORG, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
});

test('event history is retained and management never cascades offering cleanup', async () => {
  const event = record(EVENT, { status: 'draft', endsAt: '2030-01-01T00:00:00Z' });
  const unsold = record(OFFERING, { eventId: EVENT, quantitySold: 0 });
  const clean = fixture({ rows: { Event: [event], Offering: [unsold] }, related: { [`Offering.eventId.${EVENT}`]: 1 } });
  await assert.rejects(() => clean.service.remove(ADMIN, 'events', EVENT, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
  assert.equal(event.destroyed, undefined);
  assert.equal(unsold.destroyed, undefined);

  const sold = record(OFFERING, { eventId: EVENT, quantitySold: 1 });
  const blocked = fixture({ rows: { Event: [event], Offering: [sold] }, related: { [`Offering.eventId.${EVENT}`]: 1 } });
  await assert.rejects(() => blocked.service.remove(ADMIN, 'events', EVENT, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' });
});

test('management registry leaves protected financial and audit resources create/delete-disabled', async () => {
  const context = fixture();
  const metadata = await context.service.metadata(ADMIN);
  const byKey = Object.fromEntries(metadata.map((item) => [item.key, item]));
  for (const key of ['orders', 'order_items', 'payments', 'check_ins', 'audit', 'attributions', 'credentials', 'account_tokens', 'email_outbox']) {
    assert.equal(byKey[key].canCreate, false, `${key} should require its owning workflow`);
    assert.equal(byKey[key].canDelete, false, `${key} should retain history`);
  }
  assert.equal(byKey.guestlist.canCreate, true);
  assert.equal(byKey.guestlist.canDelete, false);
  assert.equal(byKey.tickets.canCreate, false);
  assert.equal(byKey.tickets.canDelete, false);
  assert.equal(byKey.users.canCreate, true, 'users are onboarded through the invite workflow');
  assert.equal(byKey.users.canDelete, false);
});

test('email outbox list and detail expose delivery diagnostics but never recipient or encrypted/provider payloads', async () => {
  const item = record(USER, { templateAlias: 'event-cancelled', status: 'failed', attemptCount: 1, nextAttemptAt: '2030-01-01T00:00:00Z', expiresAt: null, recipientEmail: 'person@example.test', encryptedVariables: 'ciphertext', providerMessageId: 'provider-secret', lastError: 'secret recipient failure' });
  const context = fixture({ rows: { EmailOutbox: [item] } });
  const list = await context.service.list(ADMIN, 'email_outbox', {});
  const detail = await context.service.detail(ADMIN, 'email_outbox', USER);
  for (const data of [list.items[0], detail]) {
    assert.equal(data.templateAlias, 'event-cancelled');
    assert.equal(data.status, 'failed');
    for (const secret of ['recipientEmail', 'encryptedVariables', 'providerMessageId', 'lastError']) assert.equal(secret in data, false, secret);
  }
});

test('management explicitly disables hard deletion for financial, attendance, and history resources', async () => {
  const fixtureRows = { Order: [record(USER)], Payment: [record(USER)], CheckIn: [record(USER)], AuditLog: [record(USER)], GuestlistEntry: [record(USER)] };
  const context = fixture({ rows: fixtureRows });
  for (const [resource, id] of [['orders', USER], ['payments', USER], ['check_ins', USER], ['audit', USER], ['guestlist', USER]]) {
    await assert.rejects(() => context.service.remove(ADMIN, resource, id, { reason: WHY }), { code: 'HARD_DELETE_DISABLED' }, resource);
  }
  assert.equal(context.calls.some(([kind]) => kind === 'destroy'), false);
});

test('team invitation creation stores only a token hash, audits without secrets, and returns a manual handoff when email is disabled', async () => {
  const organization = record(ORG, { name: 'Venue' });
  const context = fixture({ rows: { Organization: [organization] } });
  const result = await context.service.create(ADMIN, 'team_invitations', {
    organizationId: ORG, email: 'new-staff@example.test', role: 'employee', reason: WHY,
  });
  const token = new URL(result.handoff.url).searchParams.get('invite');
  assert.ok(token);
  assert.equal(result.email, 'new-staff@example.test');
  assert.equal('tokenHash' in result, false);
  const created = context.calls.find(([kind, model]) => kind === 'create' && model === 'TeamInvitation');
  assert.equal(created[2].tokenHash, require('node:crypto').createHash('sha256').update(token).digest('hex'));
  assert.notEqual(created[2].tokenHash, token);
  const audit = context.calls.find(([kind, model]) => kind === 'create' && model === 'AuditLog');
  assert.equal(audit[2].after.adminReason, WHY);
  assert.equal(JSON.stringify(audit[2]).includes(token), false);
  assert.match(result.handoff.message, /Email delivery is disabled/);
});

test('guestlist invitation uses capacity workflow and exposes the claim token only in the one-time handoff', async () => {
  const event = record(EVENT, { organizationId: ORG, status: 'published', endsAt: '2030-01-01T04:00:00Z' });
  const invitation = record(OFFERING, { eventId: EVENT, eventAffiliateId: null, email: 'guest@example.test', status: 'pending', partySize: 2 });
  const invitationService = {
    invite: async (actor, eventId, input, callbacks) => {
      assert.equal(actor, ADMIN);
      assert.equal(eventId, EVENT);
      assert.equal(input.pool, 'direct');
      await callbacks.onCreated(invitation, event, { id: 'domain-transaction' });
      return { invitation: { id: invitation.id, email: invitation.email, status: invitation.status }, entryId: null, token: 'one-time-claim-token' };
    },
  };
  const context = fixture({ rows: { Event: [event] }, guestlistInvitationService: invitationService });
  const result = await context.service.create(ADMIN, 'guestlist_invitations', {
    eventId: EVENT, email: 'guest@example.test', partySize: 2, reason: WHY,
  });
  assert.equal(new URL(result.handoff.url).searchParams.get('guestlistInvite'), 'one-time-claim-token');
  assert.equal(result.token, undefined);
  assert.equal(result.tokenHash, undefined);
  const audit = context.calls.find(([kind, model]) => kind === 'create' && model === 'AuditLog');
  assert.equal(audit[2].after.adminReason, WHY);
  assert.equal(JSON.stringify(audit[2]).includes('one-time-claim-token'), false);
});

test('guestlist invitation capability metadata reflects its schema and the default domain workflow creates a handoff', async () => {
  const event = record(EVENT, { organizationId: ORG, status: 'published', endsAt: '2030-01-01T04:00:00Z' });
  const context = fixture({ rows: {
    Event: [event],
    Organization: [record(ORG, { lifecycleState: 'active', status: 'active' })],
    User: [record(ADMIN, { isInternalAdmin: true, isActive: true, lifecycleState: 'active' })],
  } });
  context.models.GuestlistInvitation.findOne = async () => null;
  context.models.User.findOne = async () => null;

  const [inviteResource] = (await context.service.metadata(ADMIN)).filter((item) => item.key === 'guestlist_invitations');
  assert.ok(inviteResource);
  assert.equal(inviteResource.canCreate, true);

  const result = await context.service.create(ADMIN, 'guestlist_invitations', {
    eventId: EVENT, email: 'new-guest@example.test', partySize: 1, reason: WHY,
  });
  assert.equal(result.email, 'new-guest@example.test');
  assert.equal(result.status, 'pending');
  assert.ok(new URL(result.handoff.url).searchParams.get('guestlistInvite'));
  assert.equal(context.calls.some(([kind, model]) => kind === 'create' && model === 'GuestlistInvitation'), true);
  assert.equal(context.calls.some(([kind, model]) => kind === 'create' && model === 'AuditLog'), true);
});

test('pending orders cancel only when no inventory or non-failed payment exists; paid or committed orders retain history', async () => {
  const clean = record(OFFERING, { status: 'pending', paidAt: null });
  const cancellable = fixture({ rows: { Order: [clean] } });
  const result = await cancellable.service.action(ADMIN, 'orders', OFFERING, 'cancel', { reason: WHY });
  assert.equal(result.status, 'cancelled');
  assert.equal(clean.status, 'cancelled');
  assert.ok(cancellable.calls.some(([kind, model]) => kind === 'create' && model === 'AuditLog'));

  const paid = record(OFFERING, { status: 'paid', paidAt: '2026-09-28T12:00:00Z' });
  const paidContext = fixture({ rows: { Order: [paid] } });
  await assert.rejects(() => paidContext.service.action(ADMIN, 'orders', OFFERING, 'cancel', { reason: WHY }), { code: 'ORDER_PROVIDER_WORKFLOW_REQUIRED' });
  assert.equal(paid.status, 'paid');
  assert.equal(paidContext.calls.some(([kind, model]) => kind === 'create' && model === 'AuditLog'), false);

  const committed = record(OFFERING, { status: 'pending', paidAt: null });
  const committedContext = fixture({ rows: { Order: [committed] }, related: { [`OrderItem.orderId.${OFFERING}`]: 1 } });
  await assert.rejects(() => committedContext.service.action(ADMIN, 'orders', OFFERING, 'cancel', { reason: WHY }), { code: 'ORDER_COMPENSATION_REQUIRED' });
  assert.equal(committed.status, 'pending');
  assert.equal(committedContext.calls.some(([kind, model]) => kind === 'create' && model === 'AuditLog'), false);
});
