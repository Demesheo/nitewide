const { mutationTransaction } = require('./mutation-transaction');
const crypto = require('node:crypto');
const { z } = require('zod');
const { Op } = require('sequelize');
const { conflict, forbidden, notFound } = require('../domain/errors');
const { createPasswordRecord } = require('./auth-service');
const { active, activeUser } = require('./lifecycle-service');
const { hasInternalPermission } = require('./internal-admin-permissions');
const { unscoped, setBusinessRole, bumpBusiness, bumpAccount } = require('./business-membership-policy');
const { BUSINESS_SLUG_PATTERN, createBusinessSlug } = require('../domain/business-slug');
const { password: passwordSchema } = require('../http/schemas');

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const text = (max) => z.string().trim().min(1).max(max);
const reason = text(500).min(3);
const onboardingChangeSchema = z.object({ reason, version: z.number().int().min(0) }).strict();
const onboardingAcceptSchema = z.object({ token: z.string().min(20).max(200), password: z.string().optional(), confirmPassword: z.string().optional() }).strict();
const recipientSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320), displayName: text(120), phone: z.string().trim().max(32).optional(), role: z.enum(['owner', 'manager']).default('owner'), financeAuthorized: z.boolean().default(false) }).strict();
const secureLink = z.string().trim().url().max(2048).refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS link');
const venueSchema = z.object({ name: text(180), addressLine1: text(180), addressLine2: z.string().trim().max(180).optional(), city: text(100), region: z.string().trim().max(100).optional(), postalCode: z.string().trim().max(24).optional(), countryCode: z.string().length(2).toUpperCase(), timezone: text(64).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose a valid IANA timezone'), privacy: z.enum(['public', 'attendees_only', 'private']).default('public') }).strict();
const onboardingSchema = z.object({
  kind: z.enum(['user', 'organization', 'venue', 'independent_creator']),
  recipient: recipientSchema,
  // Valid legacy client slugs are tolerated but cannot choose the stored identity.
  organization: z.object({ name: text(160), slug: text(180).regex(BUSINESS_SLUG_PATTERN).optional(), description: z.string().trim().max(10000).optional(), planTier: z.enum(['free', 'premium']).default('free'), website: secureLink.optional(), socialLinks: z.array(secureLink).max(10).default([]) }).strict().transform(({ slug, ...organization }) => organization).optional(),
  venues: z.array(venueSchema).max(25).default([]), isInternalAdmin: z.boolean().default(false), internalAdminRole: z.enum(['platform_owner', 'support', 'operations', 'read_only']).optional(), confirmedAuthority: z.boolean().default(false), reason,
}).strict().superRefine((value, context) => {
  const business = value.kind !== 'user';
  if (business !== Boolean(value.organization)) context.addIssue({ code: 'custom', message: 'Business onboarding requires organization details; individual onboarding must not include them' });
  if (business && !value.confirmedAuthority) context.addIssue({ code: 'custom', path: ['confirmedAuthority'], message: 'Confirm the recipient has authority to represent this business' });
  if (!business && value.venues.length) context.addIssue({ code: 'custom', message: 'Individual onboarding cannot create organization venues' });
  if (value.kind !== 'user' && value.isInternalAdmin) context.addIssue({ code: 'custom', message: 'Internal administrator access is a separate user workflow' });
  if (value.internalAdminRole && !value.isInternalAdmin) context.addIssue({ code: 'custom', message: 'Staff permissions require internal administrator onboarding' });
  if ((!business || value.recipient.role !== 'manager') && value.recipient.financeAuthorized) context.addIssue({ code: 'custom', message: 'Explicit finance grants apply only to business managers' });
});

function createAdminOnboardingService({ models, permissions, email = null, customerAppUrl = 'http://localhost:5173', businessAppUrl = 'http://localhost:5174/app', now = () => new Date() }) {
  const transaction = async (handler) => {
    try { return await mutationTransaction(models.User.sequelize, handler, { accessChange: true }); }
    catch (error) { if (['40001', '40P01'].includes(error.original?.code || error.parent?.code) || error.name === 'SequelizeOptimisticLockError') throw conflict('This record changed concurrently. Refresh and try again.', 'CONCURRENT_CHANGE'); if (error.name === 'SequelizeUniqueConstraintError') throw conflict('An account, business, or pending invitation with these details already exists.', 'DUPLICATE_RECORD'); throw error; }
  };
  const safe = (row, delivery) => ({ id: row.id, userId: row.userId, email: row.email, accountMode: row.accountMode, organizationId: row.grants.organizationId || null, role: row.grants.role || (row.grants.organizationId ? 'owner' : null), financeAuthorized: Boolean(row.grants.role === 'owner' || (row.grants.organizationId && !row.grants.role) || row.grants.financeAuthorized), ownershipIntent: row.grants.ownershipIntent || null, outgoingOwnerUserId: row.grants.outgoingOwnerUserId || null, outgoingRole: row.grants.outgoingRole || null, expiresAt: row.expiresAt, acceptedAt: row.acceptedAt || null, revokedAt: row.revokedAt || null, version: row.version, ...(delivery ? { delivery } : {}) });
  async function audit(actor, row, action, explanation, tx) { await models.AuditLog.create({ actorUserId: actor, entityType: 'OnboardingInvitation', entityId: row.id, action: `admin.onboarding.${action}`, after: { userId: row.userId, accountMode: row.accountMode, kind: row.grants.kind, organizationId: row.grants.organizationId || null, adminReason: explanation } }, { transaction: tx }); }
  async function enqueue(row, user, raw, tx) {
    if (!email?.enabled) return 'unavailable';
    const business = row.grants.organizationId ? await models.Organization.findByPk(row.grants.organizationId, { transaction: tx }) : null;
    const url = new URL(row.grants.kind === 'user' ? customerAppUrl : businessAppUrl); url.searchParams.set('onboarding', raw);
    const queued = await email.queue({ key: `onboarding/${row.id}/${row.version}`, to: row.email, template: 'nitewide-account-setup', variables: { NAME: user.displayName, SETUP_URL: url.toString(), EXPIRES_AT: new Date(row.expiresAt).toISOString(), ACCOUNT_MODE: row.accountMode, BUSINESS_NAME: business?.name || '', ROLE: row.grants.role || (business ? 'owner' : ''), OWNERSHIP_INTENT: row.grants.ownershipIntent || '' }, expiresAt: row.expiresAt }, tx);
    return queued ? 'queued' : 'unavailable';
  }
  async function prepareRecipient(recipient, tx) {
      let user = await models.User.findOne({ where: { email: recipient.email }, transaction: tx, lock: tx.LOCK.UPDATE });
      const accountMode = user?.onboardingPending ? 'new' : user ? 'existing' : 'new';
      if (user && await models.OnboardingInvitation.findOne({ where: { userId: user.id, acceptedAt: null, revokedAt: null, expiresAt: { [Op.gt]: now() } }, transaction: tx, lock: tx.LOCK.UPDATE })) throw conflict('Revoke or resend the existing active invitation first.', 'ONBOARDING_ALREADY_PENDING');
      if (user && await models.OnboardingInvitation.count({ where: { userId: user.id, createdAt: { [Op.gte]: new Date(now().getTime() - 3600000) } }, transaction: tx }) >= 3) throw conflict('Wait before preparing another invitation for this account.', 'ONBOARDING_RATE_LIMIT');
      if (user?.onboardingPending) {
        if (await models.UserCredential.findByPk(user.id, { transaction: tx })) throw conflict('Sign in with this account instead; credentials will not be overwritten.', 'ONBOARDING_CREDENTIAL_EXISTS');
        if (!active(user) || user.isActive === false) throw conflict('Restore this account before inviting it', 'ONBOARDING_ACCOUNT_UNAVAILABLE');
        await user.update({ displayName: recipient.displayName, phone: recipient.phone || null }, { transaction: tx });
      } else if (user && !activeUser(user)) throw conflict('This account is unavailable. Restore it before inviting.', 'ONBOARDING_ACCOUNT_UNAVAILABLE');
      if (!user) user = await models.User.create({ email: recipient.email, displayName: recipient.displayName, phone: recipient.phone || null, onboardingPending: true, isActive: true, isInternalAdmin: false, independentCreator: false }, { transaction: tx });
      return { user, accountMode };
  }
  async function issue(actor, user, accountMode, grants, explanation, tx) {
      const raw = crypto.randomBytes(32).toString('base64url');
      const row = await models.OnboardingInvitation.create({ userId: user.id, invitedByUserId: actor, email: user.email, accountMode, grants, tokenHash: hash(raw), expiresAt: new Date(now().getTime() + 86400000) }, { transaction: tx });
      const delivery = await enqueue(row, user, raw, tx); await audit(actor, row, 'created', explanation, tx);
      return safe(row, delivery);
  }
  async function createAccessInvitation(actor, recipient, grants, explanation, tx) {
    await permissions.assertInternal(actor, tx);
    const { user, accountMode } = await prepareRecipient(recipientSchema.parse(recipient), tx);
    const membership = await unscoped(models.OrganizationOwner).findOne({ where: { organizationId: grants.organizationId, userId: user.id }, transaction: tx, lock: tx.LOCK.UPDATE });
    const employee = await models.OrganizationEmployee.findOne({ where: { organizationId: grants.organizationId, userId: user.id }, transaction: tx, lock: tx.LOCK.UPDATE });
    const affiliate = await models.OrgAffiliate.findOne({ where: { organizationId: grants.organizationId, userId: user.id }, transaction: tx, lock: tx.LOCK.UPDATE });
    if (membership?.role === 'owner' && active(membership)) throw conflict('This account is already an owner', 'ALREADY_ORGANIZATION_OWNER');
    return issue(actor, user, accountMode, { ...grants, incomingUserVersion: user.version, incomingMembershipVersion: membership?.version ?? null, incomingMembershipId: membership?.id || null, incomingEmployeeId: employee?.id || null, incomingEmployeeVersion: employee?.version ?? null, incomingAffiliateId: affiliate?.id || null, incomingAffiliateVersion: affiliate?.version ?? null }, explanation, tx);
  }
  async function create(actor, body, suppliedTransaction = null) {
    await permissions.assertInternal(actor); const input = onboardingSchema.parse(body);
    const work = async (tx) => {
      await permissions.assertInternal(actor, tx);
      const { user, accountMode } = await prepareRecipient(input.recipient, tx);
      const grants = { kind: input.kind, independentCreator: false, isInternalAdmin: input.isInternalAdmin, ...(input.isInternalAdmin ? { internalAdminRole: input.internalAdminRole || 'platform_owner' } : {}) };
      if (input.organization) {
        const organization = await models.Organization.create({ ...input.organization, slug: createBusinessSlug(input.organization.name), businessType: 'organization', locationId: null, onboardingEstablished: false }, { transaction: tx });
        for (const values of input.venues) {
          const location = await models.Location.create(values, { transaction: tx });
          await models.OrganizationVenue.create({ organizationId: organization.id, locationId: location.id }, { transaction: tx });
          if (!organization.locationId) await organization.update({ locationId: location.id }, { transaction: tx });
        }
        grants.organizationId = organization.id;
        grants.role = input.recipient.role; grants.financeAuthorized = input.recipient.financeAuthorized;
        grants.initialAccess = true; grants.incomingMembershipId = null; grants.incomingMembershipVersion = null;
        grants.incomingUserVersion = user.version; grants.incomingEmployeeId = null; grants.incomingEmployeeVersion = null; grants.incomingAffiliateId = null; grants.incomingAffiliateVersion = null;
        await models.AuditLog.create({ actorUserId: actor, organizationId: organization.id, entityType: 'Organization', entityId: organization.id, action: 'admin.organization.onboarded', after: { name: organization.name, businessType: organization.businessType, recipientUserId: user.id, initialRole: grants.role, financeAuthorized: grants.financeAuthorized, confirmedAuthority: true, adminReason: input.reason } }, { transaction: tx });
      }
      return issue(actor, user, accountMode, grants, input.reason, tx);
    };
    if (suppliedTransaction) {
      await require('./mutation-transaction').authorizationFence(models.User.sequelize, suppliedTransaction, true);
      return work(suppliedTransaction);
    }
    return transaction(work);
  }
  async function lookup(raw, tx) {
    z.string().min(20).max(200).parse(raw);
    const row = await models.OnboardingInvitation.findOne({ where: { tokenHash: hash(raw) }, transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
    return validateInvitation(row, tx);
  }
  async function validateInvitation(row, tx, allowExpired = false) {
    if (!row || row.acceptedAt || row.revokedAt || (!allowExpired && new Date(row.expiresAt) <= now())) throw conflict('This invitation is invalid or expired', 'ONBOARDING_INVALID');
    const user = await models.User.findByPk(row.userId, { transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
    if (!user || !active(user) || user.isActive === false || user.email !== row.email) throw conflict('This invitation is invalid or expired', 'ONBOARDING_INVALID');
    const inviter = await models.User.findByPk(row.invitedByUserId, { transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
    if (!hasInternalPermission(inviter, 'access.manage')) throw conflict('The inviter no longer has administrator access', 'ONBOARDING_INVALID');
    if (row.grants.organizationId) {
      const organization = await models.Organization.findByPk(row.grants.organizationId, { transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
      if (!active(organization) || organization.status !== 'active') throw conflict('This business is unavailable', 'ONBOARDING_SCOPE_UNAVAILABLE');
      if (row.grants.ownershipIntent || row.grants.initialAccess) {
        if (row.grants.incomingUserVersion !== undefined && row.grants.incomingUserVersion !== user.version) throw conflict('The incoming account changed. Prepare a new invitation.', 'OWNERSHIP_INVITATION_STALE');
        const membership = await unscoped(models.OrganizationOwner).findOne({ where: { organizationId: organization.id, userId: user.id }, transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
        if ((membership?.id || null) !== row.grants.incomingMembershipId || (membership?.version ?? null) !== row.grants.incomingMembershipVersion) throw conflict('The incoming account access changed. Prepare a new ownership invitation.', 'OWNERSHIP_INVITATION_STALE');
        for (const [model, idKey, versionKey] of [[models.OrganizationEmployee, 'incomingEmployeeId', 'incomingEmployeeVersion'], [models.OrgAffiliate, 'incomingAffiliateId', 'incomingAffiliateVersion']]) {
          const record = await model.findOne({ where: { organizationId: organization.id, userId: user.id }, transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
          if ((record?.id || null) !== row.grants[idKey] || (record?.version ?? null) !== row.grants[versionKey]) throw conflict('The incoming team access changed. Prepare a new ownership invitation.', 'OWNERSHIP_INVITATION_STALE');
        }
        if (row.grants.ownershipIntent === 'transfer') {
          if (organization.version !== row.grants.businessVersion) throw conflict('The business changed. Prepare a new transfer invitation.', 'OWNERSHIP_INVITATION_STALE');
          const outgoing = await unscoped(models.OrganizationOwner).findOne({ where: { organizationId: organization.id, userId: row.grants.outgoingOwnerUserId }, transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
          const outgoingUser = await models.User.findByPk(row.grants.outgoingOwnerUserId, { transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
          if (!active(outgoing) || outgoing.role !== 'owner' || outgoing.version !== row.grants.outgoingMembershipVersion || !activeUser(outgoingUser)) throw conflict('The outgoing owner changed. Prepare a new transfer invitation.', 'OWNERSHIP_INVITATION_STALE');
        }
      }
      const links = await models.OrganizationVenue.findAll({ where: { organizationId: organization.id }, transaction: tx });
      for (const link of links) {
        const venue = await models.Location.findByPk(link.locationId, { transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
        if (!active(venue)) throw conflict('An invited venue is unavailable', 'ONBOARDING_SCOPE_UNAVAILABLE');
      }
    }
    return { row, user };
  }
  async function preview(raw) {
    const { row, user } = await lookup(raw);
    return { email: row.email, displayName: user.displayName, accountMode: row.accountMode, kind: row.grants.kind, organizationId: row.grants.organizationId || null, role: row.grants.role || (row.grants.organizationId ? 'owner' : null), ownershipIntent: row.grants.ownershipIntent || null, outgoingRole: row.grants.outgoingRole || null, expiresAt: row.expiresAt };
  }
  async function accept(raw, input, authenticatedUserId = null) {
    return transaction(async (tx) => {
      const { row, user } = await lookup(raw, tx);
      if (row.accountMode === 'new') {
        const values = z.object({ password: passwordSchema, confirmPassword: z.string().min(1).max(128) }).strict().refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords must match' }).parse(input);
        if (!user.onboardingPending || await models.UserCredential.findByPk(user.id, { transaction: tx })) throw conflict('Sign in with this account instead; credentials will not be overwritten', 'ONBOARDING_CREDENTIAL_EXISTS');
        await models.UserCredential.create({ userId: user.id, ...await createPasswordRecord(values.password), passwordChangedAt: now() }, { transaction: tx });
      } else {
        z.object({}).strict().parse(input);
        if (authenticatedUserId !== user.id || !activeUser(user)) throw forbidden('Sign in with the invited account to accept access');
      }
      await user.update({ onboardingPending: false, emailVerifiedAt: now(), ...(row.grants.independentCreator ? { independentCreator: true } : {}), ...(row.grants.isInternalAdmin ? { isInternalAdmin: true, internalAdminRole: row.grants.internalAdminRole || 'platform_owner' } : {}) }, { transaction: tx });
      if (row.grants.organizationId) {
        const organization = await models.Organization.findByPk(row.grants.organizationId, { transaction: tx, lock: tx.LOCK.UPDATE });
        const role = row.grants.role || 'owner';
        await setBusinessRole({ models, organizationId: organization.id, user, role, financeAuthorized: Boolean(row.grants.financeAuthorized), actorUserId: user.id, transaction: tx });
        if (row.grants.ownershipIntent === 'transfer') {
          const outgoing = await models.User.findByPk(row.grants.outgoingOwnerUserId, { transaction: tx, lock: tx.LOCK.UPDATE });
          await setBusinessRole({ models, organizationId: organization.id, user: outgoing, role: row.grants.outgoingRole, actorUserId: row.invitedByUserId, transaction: tx });
          await bumpAccount(models, outgoing, tx);
        }
        await bumpBusiness(models, organization, tx, role === 'owner' ? { onboardingEstablished: true } : {});
        if (row.grants.ownershipIntent) await models.AuditLog.create({ actorUserId: user.id, organizationId: organization.id, entityType: 'Organization', entityId: organization.id, action: `admin.ownership.${row.grants.ownershipIntent}_accepted`, after: { incomingOwnerUserId: user.id, outgoingOwnerUserId: row.grants.outgoingOwnerUserId || null, outgoingRole: row.grants.outgoingRole || null, invitationId: row.id, requestedByUserId: row.invitedByUserId } }, { transaction: tx });
      }
      await row.update({ acceptedAt: now() }, { transaction: tx }); await audit(user.id, row, 'accepted', 'Recipient confirmed onboarding', tx);
      return { accepted: true, accountMode: row.accountMode, userId: user.id };
    });
  }
  async function change(actor, id, body, resending) {
    await permissions.assertInternal(actor); const input = onboardingChangeSchema.parse(body);
    return transaction(async (tx) => {
      await permissions.assertInternal(actor, tx);
      const row = await models.OnboardingInvitation.findByPk(z.string().uuid().parse(id), { transaction: tx, lock: tx.LOCK.UPDATE });
      if (!row) throw notFound('Onboarding invitation');
      if (row.version !== input.version) throw conflict('This invitation changed. Refresh it first.', 'STALE_VERSION');
      if (row.acceptedAt || row.revokedAt) throw conflict('This invitation is no longer pending', 'ONBOARDING_INVALID');
      let delivery;
      if (resending) {
        await validateInvitation(row, tx, true);
        const currentWindow = row.resendWindowAt && new Date(row.resendWindowAt).getTime() > now().getTime() - 3600000;
        const attempts = currentWindow ? row.resendCount || 0 : 0;
        if (attempts >= 3 || new Date(row.updatedAt).getTime() > now().getTime() - 60000) throw conflict('Wait before sending another invitation', 'ONBOARDING_RATE_LIMIT');
        const user = await models.User.findByPk(row.userId, { transaction: tx, lock: tx.LOCK.UPDATE });
        if (!active(user) || user.isActive === false || user.email !== row.email) throw conflict('This account is unavailable', 'ONBOARDING_ACCOUNT_UNAVAILABLE');
        const raw = crypto.randomBytes(32).toString('base64url');
        const previousVersion = row.version;
        await row.update({ tokenHash: hash(raw), expiresAt: new Date(now().getTime() + 86400000), resendWindowAt: currentWindow ? row.resendWindowAt : now(), resendCount: attempts + 1 }, { transaction: tx });
        if (models.EmailOutbox) await models.EmailOutbox.update({ status: 'expired', encryptedVariables: null }, { where: { dedupeKey: `onboarding/${row.id}/${previousVersion}`, status: 'pending' }, transaction: tx });
        delivery = await enqueue(row, user, raw, tx);
      } else {
        const previousVersion = row.version;
        await row.update({ revokedAt: now() }, { transaction: tx });
        if (models.EmailOutbox) await models.EmailOutbox.update({ status: 'expired', encryptedVariables: null }, { where: { dedupeKey: `onboarding/${row.id}/${previousVersion}`, status: 'pending' }, transaction: tx });
      }
      await audit(actor, row, resending ? 'resent' : 'revoked', input.reason, tx); return safe(row, delivery);
    });
  }
  return { create, preview, accept, createAccessInvitation, safeInvitation: safe, resend: (actor, id, body) => change(actor, id, body, true), revoke: (actor, id, body) => change(actor, id, body, false) };
}
module.exports = { createAdminOnboardingService, onboardingSchema, onboardingChangeSchema, onboardingAcceptSchema, venueSchema, recipientSchema };
