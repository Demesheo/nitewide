const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('node:crypto');
const { TERMS_VERSION, PRIVACY_VERSION } = require('../src/domain/terms-acceptance');
const agreement = { termsAccepted: true, termsVersion: TERMS_VERSION, privacyAcknowledged: true, privacyVersion: PRIVACY_VERSION };
const sharp = require('sharp');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createAuthService, createPasswordRecord } = require('../src/services/auth-service');
const { createEmailService, decryptVariables } = require('../src/services/email-service');
const { createAdminOnboardingService } = require('../src/services/admin-onboarding-service');
const { createBusinessAccessRequestService } = require('../src/services/business-access-request-service');
const { createPermissionService } = require('../src/services/permission-service');
const { authorizationFence } = require('../src/services/mutation-transaction');
const { DomainError } = require('../src/domain/errors');
const { buildContract } = require('../src/http/contract-build');

const PASSWORD = 'ApprovedBusiness12345';
const WHY = 'Verified this contact has business authority';
const contact = email => ({ displayName: 'Business Contact', email, phone: '(407) 555-0123',
  businessName: 'Downtown Promotion Group', role: 'owner', details: 'I operate this business and want to manage its events.', confirmedAuthority: true });
const approval = (email, version = 0, extra = {}) => ({ kind: 'organization',
  recipient: { email, displayName: 'Verified Contact', role: 'manager', financeAuthorized: false },
  organization: { name: 'Verified Promotion Group', description: 'Reviewed organization', planTier: 'free' },
  venues: [], confirmedAuthority: true, reason: WHY, version, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('Business entry and manually reviewed access requests preserve authority, invitation acceptance and atomic delivery', { timeout: 90000 }, async t => {
  assertManagedTestDatabase();
  const contracts = buildContract().contracts;
  const config = require('../src/config').getConfig();
  const db = require('../src/db/sequelize').createSequelize(config);
  const m = require('../src/db/models').initModels(db);
  const encryptionKey = 'offline-encrypted-onboarding-test-secret';
  let providerCalls = 0, queueMode = 'normal';
  const durableEmail = createEmailService({ sequelize: db, models: m, apiKey: 'offline-do-not-send', from: 'Test <test@resend.dev>',
    encryptionKey, testMode: true, deliveryPolicy: 'essential', fetchImpl: async () => { providerCalls++; throw new Error('This suite must never send email'); } });
  const email = { enabled: true, async queue(message, transaction) {
    if (queueMode === 'null') return null;
    const id = await durableEmail.queue(message, transaction);
    if (queueMode === 'throw') throw new DomainError('Offline queue failure', { code: 'EMAIL_UNAVAILABLE', status: 503 });
    return id;
  } };
  const permissions = createPermissionService(m);
  const onboarding = createAdminOnboardingService({ models: m, permissions, email, businessAppUrl: 'https://business.nitewide.test/' });
  const access = createBusinessAccessRequestService({ models: m, permissions, onboarding });
  const auth = createAuthService({ sequelize: db, models: m, tokenSecret: config.AUTH_TOKEN_SECRET, email });
  const validateResponse = (method, path, response) => {
    const contract = contracts.find(row => row.method === method && row.path === path);
    assert.ok(contract, `${method} ${path} registered`);
    const parsed = contract.responseSchemas[response.status].safeParse(response.body);
    assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    return response.body.data;
  };
  const users = {};
  const makeUser = async (name, grants = {}) => {
    const row = await m.User.create({ email: `delivered+${crypto.randomUUID()}@resend.dev`, displayName: name, ...grants });
    await m.UserCredential.create({ userId: row.id, ...passwordRecord }); return row;
  };
  let passwordRecord;
  try {
    passwordRecord = await createPasswordRecord(PASSWORD);
    users.admin = await makeUser('Administrator', { isInternalAdmin: true, internalAdminRole: 'platform_owner' });
    users.customer = await makeUser('Existing customer');
    users.reader = await makeUser('Read-only administrator', { isInternalAdmin: true, internalAdminRole: 'read_only' });
    users.support = await makeUser('Support administrator', { isInternalAdmin: true, internalAdminRole: 'support' });
    users.operations = await makeUser('Operations administrator', { isInternalAdmin: true, internalAdminRole: 'operations' });
    const app = require('../src/app').createApp({ sequelize: db, models: m, config, services: { email } });
    const api = (method, path, actor = null, body) => {
      let operation = request(app)[method](`/api${path}`);
      if (actor) operation = typeof actor === 'string' ? operation.set('Authorization', `Bearer ${actor}`) : operation.set('x-user-id', actor.id);
      return body === undefined ? operation : operation.send(body);
    };
    const signIn = (user, business = true) => api('post', business ? '/auth/business/sign-in' : '/auth/sign-in', null, { email: user.email, password: PASSWORD });
    const newEmail = () => `delivered+${crypto.randomUUID()}@resend.dev`;
    const submit = async emailAddress => { await access.submit(contact(emailAddress)); return m.BusinessAccessRequest.findOne({ where: { email: emailAddress, status: 'pending' } }); };
    const invitationToken = async invitation => {
      const outbox = await m.EmailOutbox.findOne({ where: { dedupeKey: `onboarding/${invitation.id}/0` } });
      assert.ok(outbox); assert.equal(outbox.status, 'pending');
      const variables = decryptVariables(outbox.encryptedVariables, encryptionKey);
      return new URL(variables.SETUP_URL).searchParams.get('onboarding');
    };

    await t.test('customer sessions cannot enter Business, self-create organizations, or use legacy creator authority', async () => {
      const before = await m.AuthSession.count({ where: { userId: users.customer.id } });
      const denied = await signIn(users.customer).expect(403);
      assert.equal(denied.body.error.code, 'BUSINESS_ACCESS_REQUIRED');
      assert.equal(await m.AuthSession.count({ where: { userId: users.customer.id } }), before);
      const wrong = await api('post', '/auth/business/sign-in', null, { email: users.customer.email, password: 'WrongPassword12345' }).expect(401);
      const unknown = await api('post', '/auth/business/sign-in', null, { email: newEmail(), password: PASSWORD }).expect(401);
      assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS'); assert.deepEqual(wrong.body.error.message, unknown.body.error.message);
      const customerSession = validateResponse('post', '/auth/sign-in', await signIn(users.customer, false).expect(200));
      for (const path of ['/business/bootstrap', '/business/events', '/business/overview', '/business/reports/summary', '/business/admissions/events']) {
        const result = await api('get', path, customerSession.accessToken).expect(403);
        assert.equal(result.body.error.code, 'BUSINESS_ACCESS_REQUIRED');
      }
      await api('get', '/customer/bookings', customerSession.accessToken).expect(200);
      const organizationCount = await m.Organization.count();
      await api('post', '/organizations', customerSession.accessToken, { name: 'Customer self-provision attempt' }).expect(403);
      assert.equal(await m.Organization.count(), organizationCount);
      const legacy = await m.Event.create({ creatorUserId: users.customer.id, title: 'Legacy customer event', slug: `legacy-${crypto.randomUUID()}`,
        category: 'test', status: 'draft', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000) });
      await api('post', `/events/${legacy.id}/offerings`, customerSession.accessToken, { name: 'Blocked tier', priceCents: 1000, inventoryMode: 'unlimited' }).expect(403);
      await api('post', `/events/${legacy.id}/affiliates`, customerSession.accessToken, { userId: users.customer.id, code: `BLOCK-${crypto.randomUUID()}` }).expect(403);
      await assert.rejects(permissions.assertAdmitEvent(users.customer.id, legacy.id), { code: 'FORBIDDEN' });
      assert.equal(await m.Offering.count({ where: { eventId: legacy.id } }), 0);
      const image = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#39295f' } }).png().toBuffer();
      const mediaCount = await m.MediaAsset.count();
      await request(app).post('/api/business/uploads/image').set('Authorization', `Bearer ${customerSession.accessToken}`).attach('image', image, 'flyer.png').expect(403);
      assert.equal(await m.MediaAsset.count(), mediaCount);
    });

    await t.test('public requests are generic, deduplicated, normalized and rate protected without creating accounts or grants', async () => {
      const emailAddress = newEmail();
      const beforeUsers = await m.User.count(), beforeOrganizations = await m.Organization.count();
      const first = await api('post', '/business/access-requests', null, contact(emailAddress.toUpperCase())).expect(202);
      validateResponse('post', '/business/access-requests', first);
      const duplicate = await api('post', '/business/access-requests', null, contact(emailAddress)).expect(202);
      assert.deepEqual(first.body, duplicate.body);
      const existing = await api('post', '/business/access-requests', null, contact(users.customer.email)).expect(202);
      assert.deepEqual(first.body, existing.body);
      assert.equal(await m.BusinessAccessRequest.count({ where: { email: emailAddress } }), 1);
      const row = await m.BusinessAccessRequest.findOne({ where: { email: emailAddress } });
      assert.equal(row.phone, '+14075550123'); assert.equal(row.version, 0); assert.equal(row.status, 'pending');
      assert.equal(row.organizationId, null); assert.equal(row.onboardingInvitationId, null);
      assert.equal(await m.User.count(), beforeUsers); assert.equal(await m.Organization.count(), beforeOrganizations);
      assert.equal(await m.AuditLog.count({ where: { entityType: 'BusinessAccessRequest', entityId: row.id, action: 'business.access.requested' } }), 1);
      await api('post', '/business/access-requests', null, contact(emailAddress)).expect(202);
      await api('post', '/business/access-requests', null, contact(emailAddress)).expect(429).expect('Retry-After', /\d+/);
      await api('post', '/business/access-requests', null, { ...contact(newEmail()), isInternalAdmin: true }).expect(422);
    });

    await t.test('the paged manual queue and attention list require internal directory authority and allow only administrators to review', async () => {
      await api('get', '/admin/business-access/requests').expect(401);
      await api('get', '/admin/business-access/requests', users.customer).expect(403);
      const pending = await m.BusinessAccessRequest.findOne({ where: { email: users.customer.email } });
      for (const reader of [users.reader, users.support, users.operations]) {
        const listed = await api('get', '/admin/business-access/requests', reader).query({ statuses: 'pending', search: users.customer.email, pageSize: 1 }).expect(200);
        const page = validateResponse('get', '/admin/business-access/requests', listed);
        assert.equal(page.total, 1); assert.equal(page.items[0].id, pending.id); assert.equal(page.hasMore, false);
        validateResponse('get', '/admin/business-access/requests/:id', await api('get', `/admin/business-access/requests/${pending.id}`, reader).expect(200));
        await api('post', `/admin/business-access/requests/${pending.id}/approve`, reader, approval(pending.email)).expect(403);
        await api('post', `/admin/business-access/requests/${pending.id}/decline`, reader, { version: 0, reason: WHY }).expect(403);
      }
      await api('get', '/admin/business-access/requests', users.reader).query({ pageSize: 101 }).expect(422);
      const all = validateResponse('get', '/admin/business-access/requests', await api('get', '/admin/business-access/requests', users.reader).query({ statuses: ['pending', 'approved'], pageSize: 1 }).expect(200));
      assert.equal(all.items.length, 1); assert.equal(all.hasMore, true);
      const attention = (await api('get', '/admin/overview/needs-attention', users.reader).query({ kind: 'business_access_request' }).expect(200)).body.data;
      assert.equal(attention.total, 2); assert.equal(attention.counts.business_access_request, 2);
      assert.ok(attention.items.every(row => row.recordType === 'business_access_request' && row.actionPath === `/access-requests/${row.recordId}`));
      await api('post', `/admin/business-access/requests/${pending.id}/approve`, users.admin, approval(newEmail())).expect(409);
      await api('post', `/admin/business-access/requests/${pending.id}/approve`, users.admin, approval(pending.email, 0, { confirmedAuthority: false })).expect(422);
      assert.equal((await pending.reload()).status, 'pending');
    });

    await t.test('existing customers receive no access until authenticated acceptance, and their credentials stay intact', async () => {
      const pending = await m.BusinessAccessRequest.findOne({ where: { email: users.customer.email } });
      const originalCredential = await m.UserCredential.findByPk(users.customer.id);
      const result = await api('post', `/admin/business-access/requests/${pending.id}/approve`, users.admin, approval(pending.email)).expect(200);
      const reviewed = validateResponse('post', '/admin/business-access/requests/:id/approve', result);
      assert.equal(reviewed.request.status, 'approved'); assert.equal(reviewed.request.version, 1);
      assert.equal(reviewed.invitation.delivery, 'queued'); assert.equal(reviewed.invitation.accountMode, 'existing');
      assert.equal(reviewed.request.onboardingInvitationId, reviewed.invitation.id);
      assert.equal(await m.OrganizationOwner.count({ where: { userId: users.customer.id } }), 0);
      await signIn(users.customer).expect(403);
      const token = await invitationToken(reviewed.invitation);
      const serialized = JSON.stringify(reviewed);
      assert.ok(!serialized.includes(token)); assert.ok(!serialized.includes('tokenHash'));
      await api('post', '/auth/onboarding/accept', null, { token }).expect(403);
      const customerSession = (await signIn(users.customer, false).expect(200)).body.data;
      await api('post', '/auth/onboarding/accept', customerSession.accessToken, { token }).expect(200);
      const afterCredential = await m.UserCredential.findByPk(users.customer.id);
      assert.equal(afterCredential.passwordHash, originalCredential.passwordHash); assert.equal(afterCredential.passwordSalt, originalCredential.passwordSalt);
      const membership = await m.OrganizationOwner.findOne({ where: { userId: users.customer.id, organizationId: reviewed.request.organizationId } });
      assert.equal(membership.role, 'admin'); assert.equal(membership.financeAuthorized, false);
      validateResponse('post', '/auth/business/sign-in', await signIn(users.customer).expect(200));
      await api('get', '/business/bootstrap', customerSession.accessToken).expect(200);
      const reviewedAudit = await m.AuditLog.findOne({ where: { entityType: 'BusinessAccessRequest', entityId: pending.id, action: 'admin.business_access.approved' } });
      assert.equal(reviewedAudit.actorUserId, users.admin.id); assert.equal(reviewedAudit.after.adminReason, WHY);
    });

    await t.test('new approved contacts remain pending until the queued invitation sets their own password', async () => {
      const pending = await submit(newEmail());
      const reviewed = validateResponse('post', '/admin/business-access/requests/:id/approve', await api('post', `/admin/business-access/requests/${pending.id}/approve`, users.admin,
        approval(pending.email, 0, { recipient: { email: pending.email, displayName: 'New Owner', role: 'owner' } })).expect(200));
      const invited = await m.User.findByPk(reviewed.invitation.userId);
      assert.equal(invited.onboardingPending, true); assert.equal(invited.independentCreator, false); assert.equal(invited.isInternalAdmin, false);
      assert.equal(await m.UserCredential.findByPk(invited.id), null); assert.equal(await m.OrganizationOwner.count({ where: { userId: invited.id } }), 0);
      await signIn(invited).expect(401);
      const token = await invitationToken(reviewed.invitation);
      await api('post', '/auth/onboarding/accept', null, { token, password: PASSWORD, confirmPassword: 'DifferentPassword12345', ...agreement }).expect(422);
      assert.equal((await invited.reload()).onboardingPending, true);
      await api('post', '/auth/onboarding/accept', null, { token, password: PASSWORD, confirmPassword: PASSWORD, ...agreement }).expect(200);
      assert.equal((await invited.reload()).onboardingPending, false);
      assert.equal((await m.OrganizationOwner.findOne({ where: { userId: invited.id } })).role, 'owner');
      await signIn(invited).expect(200);
      await api('post', '/auth/onboarding/accept', null, { token, password: PASSWORD, confirmPassword: PASSWORD, ...agreement }).expect(409);
    });

    await t.test('unavailable or failing email queues roll back approval, provisioning, invitations, outbox and audit together', async () => {
      for (const mode of ['null', 'throw']) {
        const pending = await submit(newEmail());
        const before = await Promise.all([m.User.count(), m.Organization.count(), m.OnboardingInvitation.count(), m.EmailOutbox.count(), m.AuditLog.count()]);
        queueMode = mode;
        try { await api('post', `/admin/business-access/requests/${pending.id}/approve`, users.admin, approval(pending.email)).expect(503); }
        finally { queueMode = 'normal'; }
        assert.deepEqual(await Promise.all([m.User.count(), m.Organization.count(), m.OnboardingInvitation.count(), m.EmailOutbox.count(), m.AuditLog.count()]), before);
        assert.equal((await pending.reload()).status, 'pending'); assert.equal(pending.version, 0); assert.equal(pending.onboardingInvitationId, null);
      }
    });

    await t.test('duplicate decisions and concurrent approve versus decline produce one versioned outcome and one audit', async () => {
      const pending = await submit(newEmail());
      const results = await Promise.allSettled([access.approve(users.admin.id, pending.id, approval(pending.email)),
        access.decline(users.admin.id, pending.id, { version: 0, reason: 'Unable to confirm this authority' })]);
      assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
      assert.equal(results.find(row => row.status === 'rejected').reason.code, 'ACCESS_REQUEST_STALE');
      const current = await pending.reload(); assert.equal(current.version, 1);
      assert.equal(await m.AuditLog.count({ where: { entityType: 'BusinessAccessRequest', entityId: pending.id, actorUserId: users.admin.id } }), 1);
      await api('post', `/admin/business-access/requests/${pending.id}/decline`, users.admin, { version: 0, reason: WHY }).expect(409);
      const declined = await submit(newEmail());
      validateResponse('post', '/admin/business-access/requests/:id/decline', await api('post', `/admin/business-access/requests/${declined.id}/decline`, users.admin, { version: 0, reason: 'Cannot confirm business ownership' }).expect(200));
      assert.equal((await declined.reload()).status, 'declined'); assert.equal(declined.onboardingInvitationId, null);
    });

    await t.test('Business eligibility uses current organization, venue and event scope rather than historical event creation', async () => {
      const creator = await makeUser('Provisioned independent creator', { independentCreator: true });
      await signIn(creator).expect(200);
      const organization = await m.Organization.create({ name: 'Gate Organization', slug: `gate-${crypto.randomUUID()}` });
      const location = await m.Location.create({ name: 'Gate Venue', addressLine1: '1 Test Street', city: 'Orlando', countryCode: 'US', timezone: 'America/New_York' });
      const linked = await m.OrganizationVenue.create({ organizationId: organization.id, locationId: location.id });
      const event = await m.Event.create({ organizationId: organization.id, locationId: location.id, creatorUserId: creator.id, title: 'Gate Event',
        slug: `gate-event-${crypto.randomUUID()}`, category: 'test', startsAt: new Date(Date.now()+3600000), endsAt: new Date(Date.now()+7200000) });
      const owner = await makeUser('Owner'), manager = await makeUser('Manager'), employee = await makeUser('Employee'), affiliate = await makeUser('Organization promoter'), venue = await makeUser('Venue promoter'), assigned = await makeUser('Selected event promoter'), automatic = await makeUser('Former automatic employee');
      await m.OrganizationOwner.bulkCreate([{ userId: owner.id, organizationId: organization.id }, { userId: manager.id, organizationId: organization.id, role: 'admin' }]);
      const employment = await m.OrganizationEmployee.create({ userId: employee.id, organizationId: organization.id });
      const orgAffiliate = await m.OrgAffiliate.create({ userId: affiliate.id, organizationId: organization.id, code: `ORG-${crypto.randomUUID()}` });
      const venueGrant = await m.VenueAccess.create({ userId: venue.id, organizationId: organization.id, locationId: location.id, role: 'promoter' });
      const assignment = await m.EventAffiliate.create({ userId: assigned.id, eventId: event.id, code: `EV-${crypto.randomUUID()}`, accessScope: null });
      await m.EventAffiliate.create({ userId: automatic.id, eventId: event.id, code: `STAFFEV-${crypto.randomUUID()}`, accessScope: null });
      for (const actor of [owner, manager, employee, affiliate, venue, assigned, users.admin, users.reader, users.support]) await signIn(actor).expect(200);
      await signIn(automatic).expect(403);
      await employment.update({ status: 'inactive' }); await signIn(employee).expect(403);
      await orgAffiliate.update({ endsAt: new Date(Date.now()-1000) }); await signIn(affiliate).expect(403);
      await orgAffiliate.update({ endsAt: null, startsAt: new Date(Date.now()+86400000) }); await signIn(affiliate).expect(403);
      await assignment.update({ endsAt: new Date(Date.now()-1000) }); await signIn(assigned).expect(403);
      await assignment.update({ endsAt: null, startsAt: new Date(Date.now()+86400000) }); await signIn(assigned).expect(403);
      await assignment.update({ startsAt: null });
      await organization.update({ lifecycleState: 'suspended', status: 'suspended' });
      await signIn(owner).expect(200); await signIn(venue).expect(200); await signIn(assigned).expect(200);
      assert.equal((await permissions.assertAdmitEvent(assigned.id, event.id)).id, event.id, 'suspended merchants retain issued admissions');
      await organization.update({ lifecycleState: 'archived', status: 'closed' });
      for (const actor of [owner, manager, venue, assigned]) await assert.rejects(permissions.assertBusinessAccess(actor.id), { code: 'BUSINESS_ACCESS_REQUIRED' });
      await organization.update({ lifecycleState: 'active', status: 'active' });
      await location.update({ lifecycleState: 'suspended' });
      await assert.rejects(permissions.assertBusinessAccess(venue.id), { code: 'BUSINESS_ACCESS_REQUIRED' });
      await assert.rejects(permissions.assertBusinessAccess(assigned.id), { code: 'BUSINESS_ACCESS_REQUIRED' });
      await location.update({ lifecycleState: 'active' });
      await assert.rejects(linked.destroy(), error => error.original?.constraint === 'venue_access_parent', 'the database preserves the required venue parent');
      await venueGrant.update({ status: 'inactive' });
      await m.EventAffiliate.create({ userId: venue.id, eventId: event.id, code: `VENUEEV-${crypto.randomUUID()}`, accessScope: 'venue', venueAccessId: venueGrant.id });
      await assert.rejects(permissions.assertBusinessAccess(venue.id), { code: 'BUSINESS_ACCESS_REQUIRED' });
      const wrongVenueUser = await makeUser('Wrong venue assignment user');
      await m.EventAffiliate.create({ userId: wrongVenueUser.id, eventId: event.id, code: `WRONGEV-${crypto.randomUUID()}`, accessScope: 'venue', venueAccessId: venueGrant.id });
      await venueGrant.update({ status: 'active' });
      await assert.rejects(permissions.assertBusinessAccess(wrongVenueUser.id), { code: 'BUSINESS_ACCESS_REQUIRED' }, 'venue assignment must reference the same user and event venue');
      assert.equal((await permissions.assertBusinessAccess(venue.id)).id, venue.id);
      await creator.update({ independentCreator: false }); await assert.rejects(permissions.assertBusinessAccess(creator.id), { code: 'BUSINESS_ACCESS_REQUIRED' });
    });

    await t.test('approval and Business sign-in recheck authority after waiting for concurrent access revocation', async () => {
      const pending = await submit(newEmail());
      const locked = deferred(), release = deferred(), checked = deferred();
      const guardedPermissions = { ...permissions, assertInternal: async (actor, transaction) => {
        const result = await permissions.assertInternal(actor, transaction);
        if (!transaction) checked.resolve(); return result;
      } };
      const guardedAccess = createBusinessAccessRequestService({ models: m, permissions: guardedPermissions, onboarding });
      const revoke = db.transaction(async transaction => {
        await authorizationFence(db, transaction, true);
        await m.User.update({ isInternalAdmin: false }, { where: { id: users.admin.id }, transaction });
        locked.resolve(); await release.promise;
      });
      await locked.promise;
      const approve = guardedAccess.approve(users.admin.id, pending.id, approval(pending.email)).then(value => ({ value }), error => ({ error }));
      try { await checked.promise; release.resolve(); await revoke; } finally { release.resolve(); }
      assert.equal((await approve).error?.code, 'FORBIDDEN'); assert.equal((await pending.reload()).status, 'pending');
      await m.User.update({ isInternalAdmin: true }, { where: { id: users.admin.id } });
      const principal = await makeUser('Concurrent Business owner');
      const organization = await m.Organization.create({ name: 'Revoked Business', slug: `revoked-${crypto.randomUUID()}` });
      const membership = await m.OrganizationOwner.create({ organizationId: organization.id, userId: principal.id });
      const signInLocked = deferred(), signInRelease = deferred(), credentialChecked = deferred();
      const originalLookup = m.UserCredential.findByPk.bind(m.UserCredential);
      m.UserCredential.findByPk = async (id, options) => { const result = await originalLookup(id, options); if (id === principal.id && !options?.transaction) credentialChecked.resolve(); return result; };
      const revocation = db.transaction(async transaction => {
        await authorizationFence(db, transaction, true);
        await membership.update({ lifecycleState: 'archived' }, { transaction });
        signInLocked.resolve(); await signInRelease.promise;
      });
      await signInLocked.promise;
      const sessionsBefore = await m.AuthSession.count({ where: { userId: principal.id } });
      const signInAttempt = auth.signInBusiness({ email: principal.email, password: PASSWORD }).then(value => ({ value }), error => ({ error }));
      try { await credentialChecked.promise; signInRelease.resolve(); await revocation; }
      finally { signInRelease.resolve(); m.UserCredential.findByPk = originalLookup; }
      assert.equal((await signInAttempt).error?.code, 'BUSINESS_ACCESS_REQUIRED');
      assert.equal(await m.AuthSession.count({ where: { userId: principal.id } }), sessionsBefore);
    });
    await t.test('an existing manager, employee and promoter can request separate ownership without cross-organization escalation', async () => {
      const principal = await makeUser('Multi-organization operator');
      const orgs = {};
      for (const role of ['manager', 'employee', 'promoter', 'unrelated']) {
        orgs[role] = await m.Organization.create({ name: `Existing ${role}`, slug: `existing-${role}-${crypto.randomUUID()}` });
      }
      const manager = await m.OrganizationOwner.create({ organizationId: orgs.manager.id, userId: principal.id, role: 'admin', financeAuthorized: false });
      const employee = await m.OrganizationEmployee.create({ organizationId: orgs.employee.id, userId: principal.id, status: 'active' });
      const promoter = await m.OrgAffiliate.create({ organizationId: orgs.promoter.id, userId: principal.id, code: `OWN-${crypto.randomUUID()}`, status: 'active' });
      const priorRows = [manager, employee, promoter].map(row => row.toJSON());
      const beforeUsers = await m.User.count(), beforeOrgs = await m.Organization.count();
      const signedBody = contact(principal.email); delete signedBody.email;
      await api('post', '/account/organization-requests', null, signedBody).expect(401);
      await api('post', '/account/organization-requests', users.customer, { ...signedBody, email: users.admin.email }).expect(422);
      await api('post', '/account/organization-requests', users.customer, { ...signedBody, confirmedAuthority: false }).expect(422);
      const submitted = validateResponse('post', '/account/organization-requests', await api('post', '/account/organization-requests', principal, signedBody).expect(202));
      assert.equal(submitted.duplicate, false); assert.equal(submitted.request.status, 'pending');
      assert.equal(await m.User.count(), beforeUsers); assert.equal(await m.Organization.count(), beforeOrgs);
      const pending = await m.BusinessAccessRequest.findByPk(submitted.request.id);
      assert.equal(pending.email, principal.email); assert.equal(pending.requesterUserId, principal.id);
      assert.equal(pending.purpose, 'new_organization'); assert.ok(pending.confirmedAuthorityAt);
      const duplicate = validateResponse('post', '/account/organization-requests', await api('post', '/account/organization-requests', principal, { ...signedBody, businessName: 'Another requested name' }).expect(202));
      assert.equal(duplicate.duplicate, true); assert.equal(duplicate.request.id, pending.id);
      const own = validateResponse('get', '/account/organization-requests', await api('get', '/account/organization-requests', principal).expect(200));
      assert.equal(own.total, 1); assert.equal(own.items[0].id, pending.id);
      assert.equal('reviewReason' in own.items[0], false); assert.equal('requesterUserId' in own.items[0], false);
      const someoneElse = validateResponse('get', '/account/organization-requests', await api('get', '/account/organization-requests', users.customer).query({ search: principal.email }).expect(200));
      assert.equal(someoneElse.total, 0);
      await api('get', '/account/organization-requests', principal).query({ userId: users.admin.id }).expect(422);
      await api('post', `/admin/business-access/requests/${pending.id}/approve`, principal, approval(principal.email)).expect(403);
      const acceptedReview = await access.approve(users.admin.id, pending.id, approval(principal.email, 0, { recipient: { email: principal.email, displayName: principal.displayName, role: 'owner' } }));
      assert.equal(acceptedReview.invitation.accountMode, 'existing');
      const newOrgId = acceptedReview.invitation.organizationId;
      assert.equal(await permissions.canManageOrganization(principal.id, newOrgId), false, 'admin approval alone grants no access');
      const token = await invitationToken(acceptedReview.invitation);
      await assert.rejects(onboarding.accept(token, {}, users.customer.id), { code: 'FORBIDDEN' });
      await onboarding.accept(token, {}, principal.id);
      assert.equal(await permissions.canManageOrganization(principal.id, newOrgId), true);
      assert.equal(await permissions.canManageFinance(principal.id, newOrgId), true);
      assert.equal(await permissions.canManageOrganization(principal.id, orgs.manager.id), true);
      assert.equal(await permissions.canManageFinance(principal.id, orgs.manager.id), false);
      for (const role of ['employee', 'promoter', 'unrelated']) {
        assert.equal(await permissions.canManageOrganization(principal.id, orgs[role].id), false, role);
        assert.equal(await permissions.canManageFinance(principal.id, orgs[role].id), false, role);
        await assert.rejects(permissions.assertCreateEvent(principal.id, orgs[role].id, null), { code: 'FORBIDDEN' });
      }
      await permissions.assertCreateEvent(principal.id, newOrgId, null);
      const afterRows = await Promise.all([m.OrganizationOwner.findByPk(manager.id), m.OrganizationEmployee.findByPk(employee.id), m.OrgAffiliate.findByPk(promoter.id)]);
      assert.deepEqual(afterRows.map(row => row.toJSON()), priorRows, 'roles, status, finance settings and row versions in other organizations never change');
      assert.equal(await m.User.count(), beforeUsers); assert.equal(await m.Organization.count(), beforeOrgs + 1);
      assert.equal((await m.User.findByPk(principal.id)).independentCreator, false);
      assert.equal((await m.User.findByPk(principal.id)).isInternalAdmin, false);
      const audit = await m.AuditLog.findOne({ where: { entityId: pending.id, action: 'business.access.requested' } });
      assert.equal(audit.actorUserId, principal.id); assert.equal(audit.after.confirmedAuthority, true);
      const another = await access.submit({ ...signedBody, businessName: 'A second separate organization' }, principal.id);
      const organizationCount = await m.Organization.count(), invitationCount = await m.OnboardingInvitation.count();
      await principal.reload();
      await principal.update({ email: newEmail() });
      const history = await access.mine(principal.id, {});
      assert.equal(history.total, 2, 'captured request ownership survives a later email change');
      await assert.rejects(access.approve(users.admin.id, another.request.id, approval(pending.email)), { code: 'ACCESS_REQUEST_ACCOUNT_CHANGED' });
      await principal.update({ email: pending.email, lifecycleState: 'suspended', isActive: false });
      await assert.rejects(access.submit(signedBody, principal.id), { code: 'FORBIDDEN' });
      await assert.rejects(access.mine(principal.id, {}), { code: 'FORBIDDEN' });
      await assert.rejects(access.approve(users.admin.id, another.request.id, approval(pending.email)), { code: 'ACCESS_REQUEST_ACCOUNT_CHANGED' });
      assert.equal(await m.Organization.count(), organizationCount); assert.equal(await m.OnboardingInvitation.count(), invitationCount);
      assert.equal((await m.BusinessAccessRequest.findByPk(another.request.id)).status, 'pending');
    });
    assert.equal(providerCalls, 0, 'only durable offline queue writes are allowed; email is never sent');
  } finally { await durableEmail.stop(); await db.close(); }
});
