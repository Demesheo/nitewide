const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAdminOnboardingService } = require('../src/services/admin-onboarding-service');

const ADMIN = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const WHY = 'Operations onboarding request';
const BASE = {
  kind: 'organization',
  recipient: { email: 'Owner@Example.Test', displayName: 'Test Owner' },
  organization: { name: 'Sample Organization', slug: 'sample-organization', planTier: 'free' },
  venues: [
    { name: 'Venue One', addressLine1: '1 First Street', city: 'Orlando', countryCode: 'US', timezone: 'America/New_York', privacy: 'private' },
    { name: 'Venue Two', addressLine1: '2 Second Street', city: 'Tampa', countryCode: 'US', timezone: 'America/New_York', privacy: 'private' },
  ],
  reason: WHY,
};

function fixture({ existingUser = null, enabled = true, now = new Date('2026-09-29T12:00:00.000Z'), deny = false } = {}) {
  const calls = [];
  const users = existingUser ? [existingUser] : [];
  users.push({ id: ADMIN, email: 'admin@example.test', displayName: 'Fixture Admin', isActive: true, isInternalAdmin: true, lifecycleState: 'active', onboardingPending: false });
  const organizations = [];
  const locations = [];
  const organizationVenues = [];
  const invitations = [];
  const credentials = new Map();
  const auditRows = [];
  const queued = [];
  const serialLock = { current: Promise.resolve() };
  const make = (rows, name) => ({
    create: async (values, options = {}) => {
      calls.push(['create', name, values, options]);
      const row = {
        id: values.id || crypto.randomUUID(),
        version: 0,
        ...values,
        toJSON() { return { ...this }; },
        update: async function update(changes) { Object.assign(this, changes); this.version += 1; return this; },
      };
      rows.push(row);
      return row;
    },
    findByPk: async (id, options = {}) => {
      calls.push(['findByPk', name, id, options]);
      return rows.find((row) => row.id === id) || null;
    },
    findOne: async ({ where = {}, transaction, lock } = {}) => {
      calls.push(['findOne', name, where, transaction, lock]);
      return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) || null;
    },
    count: async ({ where = {} } = {}) => rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).length,
    findOrCreate: async ({ where, defaults, transaction }) => {
      const found = rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value));
      return found ? [found, false] : [await model.create({ ...where, ...defaults }, { transaction }), true];
    },
  });
  let models;
  const userModel = make(users, 'User');
  userModel.sequelize = {
    transaction: async (_options, callback) => {
      // A small serial transaction facade makes race tests deterministic; the
      // PostgreSQL integration suite separately verifies real row locking.
      const previous = serialLock.current;
      let release;
      serialLock.current = new Promise((resolve) => { release = resolve; });
      await previous;
      calls.push(['transaction:start']);
      try { return await callback({ LOCK: { UPDATE: 'UPDATE' } }); }
      finally { calls.push(['transaction:commit']); release(); }
    },
  };
  const auditModel = { create: async (values, options) => { auditRows.push(values); calls.push(['audit', values, options]); return values; } };
  const credentialModel = {
    findByPk: async (id) => credentials.get(id) || null,
    create: async (values, options) => { calls.push(['credential:create', values, options]); credentials.set(values.userId, values); return values; },
  };
  const userWithCreate = { ...userModel };
  userWithCreate.findOne = async ({ where }) => users.find((row) => row.email === where.email) || null;
  userWithCreate.findByPk = async (id) => users.find((row) => row.id === id) || null;
  models = {
    User: userWithCreate,
    UserCredential: credentialModel,
    Organization: make(organizations, 'Organization'),
    Location: make(locations, 'Location'),
    OrganizationVenue: make(organizationVenues, 'OrganizationVenue'),
    OnboardingInvitation: make(invitations, 'OnboardingInvitation'),
    AuditLog: auditModel,
    OrganizationOwner: { findOrCreate: async ({ where, defaults, transaction }) => {
      calls.push(['owner:findOrCreate', where, defaults, transaction]);
      return [{ ...where, ...defaults }, true];
    } },
  };
  const permissions = { assertInternal: async (actor) => { calls.push(['authorize', actor]); if (deny || actor !== ADMIN) { const error = new Error('Internal administrator access required'); error.code = 'FORBIDDEN'; throw error; } } };
  const email = { enabled, queue: async (message, transaction) => { queued.push({ message, transaction }); return true; } };
  const service = createAdminOnboardingService({ models, permissions, email, customerAppUrl: 'https://customer.example.test', now: () => now });
  return { service, models, users, organizations, locations, organizationVenues, invitations, credentials, auditRows, queued, calls, now };
}

test('onboarding schema rejects unknown fields and inconsistent individual/business venue shapes', async () => {
  const context = fixture();
  await assert.rejects(() => context.service.create(OTHER, BASE), { code: 'FORBIDDEN' });
  await assert.rejects(() => context.service.create(ADMIN, { ...BASE, leaked: true }));
  await assert.rejects(() => context.service.create(ADMIN, { ...BASE, venues: [] }));
  await assert.rejects(() => context.service.create(ADMIN, { ...BASE, kind: 'independent_creator', organization: undefined }));
  await assert.rejects(() => context.service.create(ADMIN, { ...BASE, kind: 'venue' }));
  assert.equal(context.users.filter((user) => user.id !== ADMIN).length, 0);
  assert.equal(context.organizations.length, 0);
});

test('organization onboarding creates pending owner and two scoped venues but never returns token or handoff', async () => {
  const context = fixture();
  const created = await context.service.create(ADMIN, BASE);
  const recipient = context.users.find((user) => user.id !== ADMIN);
  assert.equal(context.users.length, 2);
  assert.equal(recipient.email, 'owner@example.test');
  assert.equal(recipient.onboardingPending, true);
  assert.equal(recipient.isInternalAdmin, false);
  assert.equal(context.organizations.length, 1);
  assert.equal(context.organizations[0].businessType, 'organization');
  assert.equal(context.locations.length, 2);
  assert.equal(context.organizationVenues.length, 2);
  assert.equal(context.organizations[0].locationId, context.locations[0].id);
  assert.equal(context.invitations[0].accountMode, 'new');
  assert.equal(context.invitations[0].grants.organizationId, context.organizations[0].id);
  assert.equal(context.queued.length, 1);
  assert.equal(context.queued[0].message.template, 'nitewide-account-setup');
  assert.equal(context.queued[0].message.to, 'owner@example.test');
  assert.ok(context.queued[0].message.variables.SETUP_URL);
  assert.match(context.invitations[0].tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(created.id, context.invitations[0].id);
  assert.equal(created.userId, recipient.id);
  assert.equal(created.delivery, 'queued');
  assert.equal('token' in created, false);
  assert.equal('handoff' in created, false);
  assert.equal(JSON.stringify(context.auditRows).includes(context.queued[0].message.variables.SETUP_URL), false);
  assert.equal(JSON.stringify(context.auditRows).includes(context.invitations[0].tokenHash), false);
});

test('preview is non-consuming; new-account accept requires confirmed password and creates verified credentials atomically', async () => {
  const context = fixture();
  await context.service.create(ADMIN, { ...BASE, kind: 'independent_creator', organization: undefined, venues: [] });
  const recipient = context.users.find((user) => user.id !== ADMIN);
  const invitation = context.invitations[0];
  const raw = new URL(context.queued[0].message.variables.SETUP_URL).searchParams.get('onboarding');
  const before = invitation.acceptedAt;
  const preview = await context.service.preview(raw);
  assert.equal(preview.accountMode, 'new');
  assert.equal(preview.kind, 'independent_creator');
  assert.equal(preview.email, 'owner@example.test');
  assert.equal(invitation.acceptedAt, before);
  assert.equal(recipient.onboardingPending, true);
  await assert.rejects(() => context.service.accept(raw, { password: 'Password12345', confirmPassword: 'Different12345' }));
  await assert.rejects(() => context.service.accept(raw, { password: 'Password12345', confirmPassword: 'Password12345', token: raw }));
  assert.equal(context.credentials.size, 0);
  const accepted = await context.service.accept(raw, { password: 'Password12345', confirmPassword: 'Password12345' });
  assert.equal(accepted.accepted, true);
  assert.equal(invitation.acceptedAt.getTime(), context.now.getTime());
  assert.equal(recipient.onboardingPending, false);
  assert.equal(recipient.independentCreator, true);
  assert.equal(recipient.emailVerifiedAt.getTime(), context.now.getTime());
  assert.notEqual(context.credentials.get(recipient.id).passwordHash, 'Password12345');
  await assert.rejects(() => context.service.accept(raw, { password: 'Password12345', confirmPassword: 'Password12345' }), { code: 'ONBOARDING_INVALID' });
});

test('existing account requires matching authenticated identity and does not create or overwrite credentials', async () => {
  const existing = { id: OTHER, email: 'owner@example.test', displayName: 'Existing Owner', isActive: true, lifecycleState: 'active', onboardingPending: false, update: async function update(values) { Object.assign(this, values); } };
  const context = fixture({ existingUser: existing });
  context.credentials.set(OTHER, { userId: OTHER, passwordHash: 'original-hash', passwordSalt: 'original-salt' });
  await context.service.create(ADMIN, { ...BASE, kind: 'user', organization: undefined, venues: [] });
  const raw = new URL(context.queued[0].message.variables.SETUP_URL).searchParams.get('onboarding');
  assert.equal(context.invitations[0].accountMode, 'existing');
  await assert.rejects(() => context.service.accept(raw, {}, null), { code: 'FORBIDDEN' });
  await assert.rejects(() => context.service.accept(raw, { password: 'Overwrite12345', confirmPassword: 'Overwrite12345' }, OTHER));
  const accepted = await context.service.accept(raw, {}, OTHER);
  assert.equal(accepted.accepted, true);
  assert.equal(context.credentials.get(OTHER).passwordHash, 'original-hash');
  assert.equal(context.credentials.get(OTHER).passwordSalt, 'original-salt');
  assert.equal(existing.onboardingPending, false);
});

test('expired, revoked, wrong-token and email-changed invitations are invalid and read-only preview never accepts', async () => {
  const context = fixture();
  await context.service.create(ADMIN, { ...BASE, kind: 'user', organization: undefined, venues: [] });
  const raw = new URL(context.queued[0].message.variables.SETUP_URL).searchParams.get('onboarding');
  await assert.rejects(() => context.service.preview(`${raw}bad`), { code: 'ONBOARDING_INVALID' });
  context.invitations[0].expiresAt = new Date(context.now.getTime() - 1);
  await assert.rejects(() => context.service.preview(raw), { code: 'ONBOARDING_INVALID' });
  context.invitations[0].expiresAt = new Date(context.now.getTime() + 1000);
  const recipient = context.users.find((user) => user.id !== ADMIN);
  recipient.email = 'changed@example.test';
  await assert.rejects(() => context.service.preview(raw), { code: 'ONBOARDING_INVALID' });
  recipient.email = context.invitations[0].email;
  context.invitations[0].revokedAt = context.now;
  await assert.rejects(() => context.service.preview(raw), { code: 'ONBOARDING_INVALID' });
});

test('email-disabled onboarding creates an explicit unavailable delivery and never returns a raw setup link', async () => {
  const context = fixture({ enabled: false });
  const result = await context.service.create(ADMIN, { ...BASE, kind: 'user', organization: undefined, venues: [] });
  const recipient = context.users.find((user) => user.id !== ADMIN);
  assert.equal(result.delivery, 'unavailable');
  assert.equal('token' in result, false);
  assert.equal('handoff' in result, false);
  assert.equal(context.queued.length, 0);
  assert.equal(recipient.onboardingPending, true);
  assert.equal(context.invitations.length, 1);
});
