const { mutationTransaction } = require('./mutation-transaction');
const { z } = require('zod');
const { Op } = require('sequelize');
const { conflict, notFound } = require('../domain/errors');
const { assertUserAccessChange } = require('./admin-access-guards');
const crypto = require('node:crypto');
const { TEMPLATES } = require('./email-templates');
const { venueSchema } = require('./admin-onboarding-service');
const { revokePendingGuestlistInvitations } = require('./guestlist-invitation-policy');
const { assertCommissionPricing } = require('../domain/editor-pricing-policy');

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();
const envelope = { reason: text(500).min(3), version: z.number().int().min(0) };
const schemas = {
  users: z.object({ ...envelope, displayName: text(120).optional(), email: z.string().trim().toLowerCase().email().max(320).optional(), confirmEmail: z.string().trim().toLowerCase().email().max(320).optional(), phone: optionalText(32), confirmPhone: optionalText(32), isInternalAdmin: z.boolean().optional(), internalAdminRole: z.enum(['platform_owner', 'support', 'operations', 'read_only']).nullable().optional(), independentCreator: z.boolean().optional() }).strict(),
  organizations: z.object({ ...envelope, name: text(160).optional(), description: optionalText(10000), planTier: z.enum(['free', 'premium']).optional(), locationId: uuid.nullable().optional(), venueIds: z.array(uuid).max(25).optional() }).strict(),
  events: z.object({ ...envelope, title: text(180).min(2).optional(), slug: text(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), summary: optionalText(500), description: optionalText(20000), category: text(80).optional(), status: z.enum(['draft', 'published', 'cancelled', 'completed']).optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), capacity: z.number().int().min(0).max(1000000).nullable().optional(), guestlistCapacity: z.number().int().min(0).max(1000000).optional(), isDiscoverable: z.boolean().optional(), creatorUserId: uuid.optional(), organizationId: uuid.nullable().optional(), locationId: uuid.nullable().optional(), imageAssetId: uuid.nullable().optional() }).strict(),
  locations: venueSchema.partial().extend(envelope).strict(),
  owners: z.object({ ...envelope, role: z.enum(['owner', 'admin']) }).strict(),
  employees: z.object({ ...envelope, status: z.enum(['active', 'inactive']) }).strict(),
  organization_affiliates: z.object({ ...envelope, status: z.enum(['active', 'inactive']).optional(), defaultCommissionBps: z.number().int().min(0).max(4000).optional(), defaultGuestlistAllocation: z.number().int().min(0).optional() }).strict(),
  event_affiliates: z.object({ ...envelope, status: z.enum(['active', 'inactive']).optional(), commissionBps: z.number().int().min(0).max(4000).nullable().optional(), guestlistAllocation: z.number().int().min(0).nullable().optional() }).strict(),
};
const modelsFor = { users: 'User', organizations: 'Organization', events: 'Event', locations: 'Location', owners: 'OrganizationOwner', employees: 'OrganizationEmployee', organization_affiliates: 'OrgAffiliate', event_affiliates: 'EventAffiliate' };
function createAdminEditService({ models, permissions, email = null, customerAppUrl = 'http://localhost:5173' }) {
  async function update(actor, key, id, body) {
    const permission = ['events', 'locations'].includes(key) ? 'events.manage' : 'access.manage';
    const authorize = (transaction) => permissions.assertInternalPermission ? permissions.assertInternalPermission(actor, permission, transaction) : permissions.assertInternal(actor, transaction);
    await authorize(); // Preflight only; authoritative check is inside the fence below.
    if (key === 'owners') throw conflict('Add, remove, or transfer ownership through the secure ownership workflow.', 'OWNERSHIP_ACCEPTANCE_REQUIRED');
    if (key === 'events') throw conflict('Edit the event through the shared event editor.', 'EVENT_EDITOR_REQUIRED');
    if (!schemas[key]) throw conflict('This resource is edited through its domain workflow', 'UNSUPPORTED_EDIT');
    const parsed = schemas[key].parse(body); const { reason, version, ...changes } = parsed;
    if (key === 'organizations' && (changes.locationId !== undefined || changes.venueIds !== undefined)) throw conflict('Manage venues individually from the business Venues tab.', 'VENUE_MANAGEMENT_REQUIRED');
    if (key === 'users') {
      if (changes.email !== undefined && changes.email !== changes.confirmEmail) throw conflict('Confirm the changed email address', 'EMAIL_CONFIRMATION_REQUIRED');
      if (changes.phone !== undefined && changes.phone !== changes.confirmPhone) throw conflict('Confirm the changed phone number', 'PHONE_CONFIRMATION_REQUIRED');
      delete changes.confirmEmail; delete changes.confirmPhone;
    }
    if (!Object.keys(changes).length) throw conflict('Choose a field to update', 'EMPTY_EDIT');
    return mutationTransaction(models.User.sequelize, async (transaction) => {
      await authorize(transaction);
      const model = models[modelsFor[key]];
      const record = await (model.unscoped ? model.unscoped() : model).findByPk(uuid.parse(id), { transaction, lock: transaction.LOCK.UPDATE });
      if (!record) throw notFound('Record');
      if ((record.version ?? 0) !== version) throw conflict('This record changed. Refresh before editing.', 'STALE_VERSION');
      const before = record.toJSON ? record.toJSON() : { ...record };
      let emailVerificationDelivery;
      if (key === 'organization_affiliates' && changes.defaultCommissionBps !== undefined) await assertCommissionPricing({ models, organizationId: record.organizationId, commissionBps: changes.defaultCommissionBps, transaction });
      if (key === 'event_affiliates' && changes.commissionBps !== undefined) {
        const organizationAffiliate = changes.commissionBps == null && record.orgAffiliateId ? await models.OrgAffiliate.findByPk(record.orgAffiliateId, { transaction }) : null;
        await assertCommissionPricing({ models, eventId: record.eventId, commissionBps: changes.commissionBps ?? organizationAffiliate?.defaultCommissionBps ?? 0, transaction });
      }
      if (key === 'users') {
        if (changes.independentCreator === true && !record.independentCreator) throw conflict('Create a business workspace through secure onboarding rather than adding a legacy creator permission.', 'BUSINESS_ONBOARDING_REQUIRED');
        await assertUserAccessChange({ models, actorUserId: actor, user: record, changes, transaction });
        if (changes.email && changes.email !== record.email) {
          if (record.onboardingPending && await models.OnboardingInvitation.findOne({ where: { userId: id, acceptedAt: null, revokedAt: null, expiresAt: { [Op.gt]: new Date() } }, transaction })) throw conflict('Revoke the active setup invitation before changing its recipient email.', 'ONBOARDING_ALREADY_PENDING');
          if (await models.User.findOne({ where: { email: changes.email, id: { [Op.ne]: id } }, transaction })) throw conflict('This email belongs to another account', 'DUPLICATE_EMAIL');
          changes.emailVerifiedAt = null;
          await models.UserActionToken.update({ consumedAt: new Date() }, { where: { userId: id, consumedAt: null }, transaction });
          await models.OnboardingInvitation.update({ revokedAt: new Date() }, { where: { userId: id, acceptedAt: null, revokedAt: null }, transaction });
          // Rotate the session version without changing either credential secret.
          await models.UserCredential.update({ passwordChangedAt: new Date() }, { where: { userId: id }, transaction });
          emailVerificationDelivery = 'unavailable';
          if (email?.enabled) {
            const raw = crypto.randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + 86400000);
            const action = await models.UserActionToken.create({ userId: id, purpose: 'verify_email', email: changes.email, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), expiresAt }, { transaction });
            const url = new URL(customerAppUrl); url.searchParams.set('verifyEmail', raw);
            emailVerificationDelivery = await email.queue({ key: `verify_email/${action.id}`, to: changes.email, template: TEMPLATES.verifyEmail, variables: { NAME: changes.displayName || record.displayName, VERIFY_URL: url.toString() }, expiresAt }, transaction) ? 'queued' : 'unavailable';
          }
        }
      }
      const fieldChanged = Object.entries(changes).some(([name, value]) => value instanceof Date ? new Date(record[name]).getTime() !== value.getTime() : record[name] !== value);
      if (!fieldChanged) return before;
      await record.update(changes, { transaction });
      if (changes.status === 'inactive' && ['employees', 'organization_affiliates', 'event_affiliates'].includes(key)) {
        await revokePendingGuestlistInvitations({ models, actorUserId: actor, transaction,
          ...(key === 'event_affiliates' ? { eventAffiliateId: record.id } : { organizationId: record.organizationId, userId: record.userId }) });
      }
      if (key === 'users' && changes.independentCreator === false) await revokePendingGuestlistInvitations({ models, userId: id, actorUserId: actor, transaction });
      const after = record.toJSON ? record.toJSON() : { ...record };
      await models.AuditLog.create({ actorUserId: actor, organizationId: key === 'organizations' ? id : record.organizationId || null, entityType: modelsFor[key], entityId: id, action: `admin.${modelsFor[key].toLowerCase()}.updated`, before, after: { ...after, adminReason: reason } }, { transaction });
      return emailVerificationDelivery ? { ...after, emailVerificationDelivery } : after;
    }, { accessChange: true });
  }
  return { update };
}
module.exports = { createAdminEditService, schemas };
