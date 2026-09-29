const crypto = require('node:crypto');
const { z } = require('zod');
const { Op, Transaction } = require('sequelize');
const { conflict, forbidden, notFound } = require('../domain/errors');
const { createPasswordRecord } = require('./auth-service');
const { active, activeUser } = require('./lifecycle-service');

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const text = (max) => z.string().trim().min(1).max(max);
const reason = text(500).min(3);
const venueSchema = z.object({ name: text(180), addressLine1: text(180), addressLine2: z.string().trim().max(180).optional(), city: text(100), region: z.string().trim().max(100).optional(), postalCode: z.string().trim().max(24).optional(), countryCode: z.string().length(2).toUpperCase(), timezone: text(64).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose a valid IANA timezone'), privacy: z.enum(['public', 'attendees_only', 'private']).default('public') }).strict();
const onboardingSchema = z.object({
  kind: z.enum(['user', 'organization', 'venue', 'independent_creator']),
  recipient: z.object({ email: z.string().trim().toLowerCase().email().max(320), displayName: text(120), phone: z.string().trim().max(32).optional() }).strict(),
  organization: z.object({ name: text(160), slug: text(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().trim().max(10000).optional(), planTier: z.enum(['free', 'premium']).default('free') }).strict().optional(),
  venues: z.array(venueSchema).max(25).default([]), isInternalAdmin: z.boolean().default(false), reason,
}).strict().superRefine((value, context) => {
  const business = ['organization', 'venue'].includes(value.kind);
  if (business !== Boolean(value.organization)) context.addIssue({ code: 'custom', message: 'Business onboarding requires organization details; individual onboarding must not include them' });
  if (value.kind === 'venue' && value.venues.length !== 1) context.addIssue({ code: 'custom', message: 'Single-venue onboarding requires exactly one venue' });
  if (value.kind === 'organization' && !value.venues.length) context.addIssue({ code: 'custom', message: 'Add at least one venue for this business' });
  if (!business && value.venues.length) context.addIssue({ code: 'custom', message: 'Individual onboarding cannot create organization venues' });
  if (value.kind !== 'user' && value.isInternalAdmin) context.addIssue({ code: 'custom', message: 'Internal administrator access is a separate user workflow' });
});

function createAdminOnboardingService({ models, permissions, email = null, customerAppUrl = 'http://localhost:5173', businessAppUrl = 'http://localhost:5174/app', now = () => new Date() }) {
  const transaction = async (handler) => {
    try { return await models.User.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, handler); }
    catch (error) { if (['40001', '40P01'].includes(error.original?.code || error.parent?.code) || error.name === 'SequelizeOptimisticLockError') throw conflict('This record changed concurrently. Refresh and try again.', 'CONCURRENT_CHANGE'); if (error.name === 'SequelizeUniqueConstraintError') throw conflict('An account, business, or pending invitation with these details already exists.', 'DUPLICATE_RECORD'); throw error; }
  };
  const safe = (row, delivery) => ({ id: row.id, userId: row.userId, accountMode: row.accountMode, expiresAt: row.expiresAt, acceptedAt: row.acceptedAt || null, revokedAt: row.revokedAt || null, version: row.version, ...(delivery ? { delivery } : {}) });
  async function audit(actor, row, action, explanation, tx) { await models.AuditLog.create({ actorUserId: actor, entityType: 'OnboardingInvitation', entityId: row.id, action: `admin.onboarding.${action}`, after: { userId: row.userId, accountMode: row.accountMode, kind: row.grants.kind, organizationId: row.grants.organizationId || null, adminReason: explanation } }, { transaction: tx }); }
  async function enqueue(row, user, raw, tx) {
    if (!email?.enabled) return 'unavailable';
    const url = new URL(row.grants.kind === 'user' ? customerAppUrl : businessAppUrl); url.searchParams.set('onboarding', raw);
    const queued = await email.queue({ key: `onboarding/${row.id}/${row.version}`, to: row.email, template: 'nitewide-account-setup', variables: { NAME: user.displayName, SETUP_URL: url.toString(), EXPIRES_AT: new Date(row.expiresAt).toISOString(), ACCOUNT_MODE: row.accountMode }, expiresAt: row.expiresAt }, tx);
    return queued ? 'queued' : 'unavailable';
  }
  async function create(actor, body) {
    await permissions.assertInternal(actor); const input = onboardingSchema.parse(body);
    return transaction(async (tx) => {
      let user = await models.User.findOne({ where: { email: input.recipient.email }, transaction: tx, lock: tx.LOCK.UPDATE });
      const accountMode = user?.onboardingPending ? 'new' : user ? 'existing' : 'new';
      if (user && await models.OnboardingInvitation.findOne({ where: { userId: user.id, acceptedAt: null, revokedAt: null, expiresAt: { [Op.gt]: now() } }, transaction: tx, lock: tx.LOCK.UPDATE })) throw conflict('Revoke or resend the existing active invitation first.', 'ONBOARDING_ALREADY_PENDING');
      if (user && await models.OnboardingInvitation.count({ where: { userId: user.id, createdAt: { [Op.gte]: new Date(now().getTime() - 3600000) } }, transaction: tx }) >= 3) throw conflict('Wait before preparing another invitation for this account.', 'ONBOARDING_RATE_LIMIT');
      if (user?.onboardingPending) {
        if (await models.UserCredential.findByPk(user.id, { transaction: tx })) throw conflict('Sign in with this account instead; credentials will not be overwritten.', 'ONBOARDING_CREDENTIAL_EXISTS');
        if (!active(user) || user.isActive === false) throw conflict('Restore this account before inviting it', 'ONBOARDING_ACCOUNT_UNAVAILABLE');
        await user.update({ displayName: input.recipient.displayName, phone: input.recipient.phone || null }, { transaction: tx });
      } else if (user && !activeUser(user)) throw conflict('This account is unavailable. Restore it before inviting.', 'ONBOARDING_ACCOUNT_UNAVAILABLE');
      if (!user) user = await models.User.create({ ...input.recipient, onboardingPending: true, isActive: true, isInternalAdmin: false, independentCreator: false }, { transaction: tx });
      const grants = { kind: input.kind, independentCreator: input.kind === 'independent_creator', isInternalAdmin: input.isInternalAdmin };
      if (input.organization) {
        const organization = await models.Organization.create({ ...input.organization, businessType: input.kind, locationId: null }, { transaction: tx });
        for (const values of input.venues) {
          const location = await models.Location.create(values, { transaction: tx });
          await models.OrganizationVenue.create({ organizationId: organization.id, locationId: location.id }, { transaction: tx });
          if (!organization.locationId) await organization.update({ locationId: location.id }, { transaction: tx });
        }
        grants.organizationId = organization.id;
        await models.AuditLog.create({ actorUserId: actor, organizationId: organization.id, entityType: 'Organization', entityId: organization.id, action: 'admin.organization.onboarded', after: { name: organization.name, businessType: organization.businessType, recipientUserId: user.id, pendingOwnership: true, adminReason: input.reason } }, { transaction: tx });
      }
      const raw = crypto.randomBytes(32).toString('base64url');
      const row = await models.OnboardingInvitation.create({ userId: user.id, invitedByUserId: actor, email: user.email, accountMode, grants, tokenHash: hash(raw), expiresAt: new Date(now().getTime() + 86400000) }, { transaction: tx });
      const delivery = await enqueue(row, user, raw, tx); await audit(actor, row, 'created', input.reason, tx);
      return safe(row, delivery);
    });
  }
  async function lookup(raw, tx) {
    z.string().min(20).max(200).parse(raw);
    const row = await models.OnboardingInvitation.findOne({ where: { tokenHash: hash(raw) }, transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
    if (!row || row.acceptedAt || row.revokedAt || new Date(row.expiresAt) <= now()) throw conflict('This invitation is invalid or expired', 'ONBOARDING_INVALID');
    const user = await models.User.findByPk(row.userId, { transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
    if (!user || !active(user) || user.isActive === false || user.email !== row.email) throw conflict('This invitation is invalid or expired', 'ONBOARDING_INVALID');
    const inviter = await models.User.findByPk(row.invitedByUserId, { transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
    if (!activeUser(inviter) || !inviter.isInternalAdmin) throw conflict('The inviter no longer has administrator access', 'ONBOARDING_INVALID');
    if (row.grants.organizationId) {
      const organization = await models.Organization.findByPk(row.grants.organizationId, { transaction: tx, ...(tx ? { lock: tx.LOCK.UPDATE } : {}) });
      if (!active(organization) || organization.status !== 'active') throw conflict('This business is unavailable', 'ONBOARDING_SCOPE_UNAVAILABLE');
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
    return { email: row.email, displayName: user.displayName, accountMode: row.accountMode, kind: row.grants.kind, expiresAt: row.expiresAt };
  }
  async function accept(raw, input, authenticatedUserId = null) {
    return transaction(async (tx) => {
      const { row, user } = await lookup(raw, tx);
      if (row.accountMode === 'new') {
        const values = z.object({ password: z.string().min(12).max(128), confirmPassword: z.string().min(12).max(128) }).strict().refine((value) => value.password === value.confirmPassword, 'Passwords must match').parse(input);
        if (!user.onboardingPending || await models.UserCredential.findByPk(user.id, { transaction: tx })) throw conflict('Sign in with this account instead; credentials will not be overwritten', 'ONBOARDING_CREDENTIAL_EXISTS');
        await models.UserCredential.create({ userId: user.id, ...await createPasswordRecord(values.password), passwordChangedAt: now() }, { transaction: tx });
      } else {
        z.object({}).strict().parse(input);
        if (authenticatedUserId !== user.id || !activeUser(user)) throw forbidden('Sign in with the invited account to accept access');
      }
      await user.update({ onboardingPending: false, emailVerifiedAt: now(), ...(row.grants.independentCreator ? { independentCreator: true } : {}), ...(row.grants.isInternalAdmin ? { isInternalAdmin: true } : {}) }, { transaction: tx });
      if (row.grants.organizationId) await models.OrganizationOwner.findOrCreate({ where: { organizationId: row.grants.organizationId, userId: user.id }, defaults: { role: 'owner' }, transaction: tx });
      await row.update({ acceptedAt: now() }, { transaction: tx }); await audit(user.id, row, 'accepted', 'Recipient confirmed onboarding', tx);
      return { accepted: true, accountMode: row.accountMode, userId: user.id };
    });
  }
  async function change(actor, id, body, resending) {
    await permissions.assertInternal(actor); const input = z.object({ reason, version: z.number().int().min(0) }).strict().parse(body);
    return transaction(async (tx) => {
      const row = await models.OnboardingInvitation.findByPk(z.string().uuid().parse(id), { transaction: tx, lock: tx.LOCK.UPDATE });
      if (!row) throw notFound('Onboarding invitation');
      if (row.version !== input.version) throw conflict('This invitation changed. Refresh it first.', 'STALE_VERSION');
      if (row.acceptedAt || row.revokedAt) throw conflict('This invitation is no longer pending', 'ONBOARDING_INVALID');
      let delivery;
      if (resending) {
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
  return { create, preview, accept, resend: (actor, id, body) => change(actor, id, body, true), revoke: (actor, id, body) => change(actor, id, body, false) };
}
module.exports = { createAdminOnboardingService, onboardingSchema, venueSchema };
