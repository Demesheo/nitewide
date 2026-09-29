const { z } = require('zod');
const { Op, Transaction } = require('sequelize');
const { conflict, notFound } = require('../domain/errors');
const { assertUserAccessChange } = require('./admin-access-guards');
const { assertOrganizationVenue } = require('./lifecycle-service');
const { queueEventEmail, formatTime, venueName } = require('./email-events');
const crypto = require('node:crypto');
const { TEMPLATES } = require('./email-templates');
const { venueSchema } = require('./admin-onboarding-service');

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();
const envelope = { reason: text(500).min(3), version: z.number().int().min(0) };
const schemas = {
  users: z.object({ ...envelope, displayName: text(120).optional(), email: z.string().trim().toLowerCase().email().max(320).optional(), confirmEmail: z.string().trim().toLowerCase().email().max(320).optional(), phone: optionalText(32), confirmPhone: optionalText(32), isInternalAdmin: z.boolean().optional(), independentCreator: z.boolean().optional() }).strict(),
  organizations: z.object({ ...envelope, name: text(160).optional(), slug: text(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), description: optionalText(10000), planTier: z.enum(['free', 'premium']).optional(), businessType: z.enum(['organization', 'venue']).optional(), locationId: uuid.nullable().optional(), venueIds: z.array(uuid).max(25).optional() }).strict(),
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
    await permissions.assertInternal(actor);
    if (!schemas[key]) throw conflict('This resource is edited through its domain workflow', 'UNSUPPORTED_EDIT');
    const parsed = schemas[key].parse(body); const { reason, version, ...changes } = parsed;
    if (key === 'users') {
      if (changes.email !== undefined && changes.email !== changes.confirmEmail) throw conflict('Confirm the changed email address', 'EMAIL_CONFIRMATION_REQUIRED');
      if (changes.phone !== undefined && changes.phone !== changes.confirmPhone) throw conflict('Confirm the changed phone number', 'PHONE_CONFIRMATION_REQUIRED');
      delete changes.confirmEmail; delete changes.confirmPhone;
    }
    if (!Object.keys(changes).length) throw conflict('Choose a field to update', 'EMPTY_EDIT');
    return models.User.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const model = models[modelsFor[key]];
      const record = await (model.unscoped ? model.unscoped() : model).findByPk(uuid.parse(id), { transaction, lock: transaction.LOCK.UPDATE });
      if (!record) throw notFound('Record');
      if ((record.version ?? 0) !== version) throw conflict('This record changed. Refresh before editing.', 'STALE_VERSION');
      const before = record.toJSON ? record.toJSON() : { ...record };
      let emailVerificationDelivery;
      let relationshipChanged = false;
      if (key === 'users') {
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
      if (key === 'owners' && record.role === 'owner' && changes.role !== 'owner') {
        const owners = await models.OrganizationOwner.findAll({ where: { organizationId: record.organizationId, role: 'owner', userId: { [Op.ne]: record.userId } }, transaction, lock: transaction.LOCK.UPDATE });
        let remaining = 0;
        for (const owner of owners) { const user = await models.User.findByPk(owner.userId, { transaction, lock: transaction.LOCK.UPDATE }); if (user?.isActive && !user.onboardingPending && (!user.lifecycleState || user.lifecycleState === 'active')) remaining += 1; }
        if (!remaining) throw conflict('Assign another active, completed owner before changing the last owner', 'LAST_ORGANIZATION_OWNER');
      }
      if (key === 'organizations') {
        const venueIds = changes.venueIds; delete changes.venueIds;
        if (venueIds) {
          const unique = [...new Set(venueIds)];
          if ((changes.businessType || record.businessType) === 'venue' && unique.length !== 1) throw conflict('A single-venue business requires exactly one venue', 'SINGLE_VENUE_REQUIRED');
          const existing = await models.OrganizationVenue.findAll({ where: { organizationId: id }, transaction, lock: transaction.LOCK.UPDATE });
          relationshipChanged = existing.length !== unique.length || existing.some((link) => !unique.includes(link.locationId));
          for (const locationId of unique) if (!await models.Location.findByPk(locationId, { transaction })) throw notFound('Venue');
          for (const link of existing.filter((link) => !unique.includes(link.locationId))) {
            if (await models.Event.count({ where: { organizationId: id, locationId: link.locationId }, transaction })) throw conflict('A venue used by event history cannot be unlinked', 'VENUE_EVENT_HISTORY');
            await link.destroy({ transaction });
          }
          for (const locationId of unique) await models.OrganizationVenue.findOrCreate({ where: { organizationId: id, locationId }, transaction });
          changes.locationId = changes.locationId === undefined ? (unique.includes(record.locationId) ? record.locationId : unique[0] || null) : changes.locationId;
        }
        if (changes.locationId) await assertOrganizationVenue(models, record, changes.locationId, transaction);
        if ((changes.businessType || record.businessType) === 'venue' && await models.OrganizationVenue.count({ where: { organizationId: id }, transaction }) !== 1) throw conflict('A single-venue business requires exactly one venue', 'SINGLE_VENUE_REQUIRED');
      }
      if (key === 'events') {
        const merged = { ...before, ...changes };
        if (new Date(merged.endsAt) <= new Date(merged.startsAt)) throw conflict('Event end must be after start', 'INVALID_EVENT_TIME');
        if (new Date(record.endsAt) <= new Date() || record.status === 'completed') throw conflict('Past events retain their history and cannot be edited', 'EVENT_FINISHED');
        if (changes.creatorUserId || changes.organizationId !== undefined) {
          const historical = await models.Order.count({ where: { eventId: id }, transaction }) + await models.GuestlistEntry.count({ where: { eventId: id }, transaction });
          if (historical) throw conflict('Ownership cannot be reassigned after purchase or guestlist activity', 'EVENT_OWNERSHIP_HISTORY');
        }
        if (merged.organizationId) {
          const organization = await models.Organization.findByPk(merged.organizationId, { transaction }); if (!organization) throw notFound('Organization');
          await assertOrganizationVenue(models, organization, merged.locationId, transaction);
        }
        if (changes.creatorUserId && !await models.User.findByPk(changes.creatorUserId, { transaction })) throw notFound('Creator');
        if (changes.imageAssetId && !await models.MediaAsset.findByPk(changes.imageAssetId, { transaction })) throw notFound('Image');
        const tickets = await models.Ticket.count({ where: { eventId: id, status: { [Op.in]: ['valid', 'checked_in', 'transferred'] } }, transaction });
        const approved = Number(await models.GuestlistEntry.sum('partySize', { where: { eventId: id, status: { [Op.in]: ['confirmed', 'checked_in'] } }, transaction })) || 0;
        if (changes.capacity != null && changes.capacity < tickets + approved) throw conflict('Capacity cannot fall below ticket and approved guestlist admissions', 'EVENT_CAPACITY');
        if (changes.guestlistCapacity !== undefined && changes.guestlistCapacity < (await models.GuestlistEntry.sum('partySize', { where: { eventId: id, eventAffiliateId: null, status: { [Op.in]: ['confirmed', 'checked_in'] } }, transaction }) || 0)) throw conflict('Direct guestlist capacity cannot fall below approved guests', 'GUESTLIST_CAPACITY');
      }
      const fieldChanged = Object.entries(changes).some(([name, value]) => value instanceof Date ? new Date(record[name]).getTime() !== value.getTime() : record[name] !== value);
      if (!fieldChanged && !relationshipChanged) return before;
      if (fieldChanged) await record.update(changes, { transaction });
      else { await record.increment('version', { transaction }); await record.reload({ transaction }); }
      const after = record.toJSON ? record.toJSON() : { ...record };
      await models.AuditLog.create({ actorUserId: actor, organizationId: key === 'organizations' ? id : record.organizationId || null, entityType: modelsFor[key], entityId: id, action: `admin.${modelsFor[key].toLowerCase()}.updated`, before, after: { ...after, adminReason: reason } }, { transaction });
      if (key === 'events' && before.status === 'published') {
        if (record.status === 'cancelled') await queueEventEmail({ email, models, event: record, kind: 'cancelled', variables: { EVENT_DATE: formatTime(before.startsAt) }, customerAppUrl, transaction, key: `admin-cancelled-${record.version}` });
        else if (Math.abs(+new Date(record.startsAt) - +new Date(before.startsAt)) >= 900000 || Math.abs(+new Date(record.endsAt) - +new Date(before.endsAt)) >= 900000) await queueEventEmail({ email, models, event: record, kind: 'timeChange', variables: { OLD_TIME: `${formatTime(before.startsAt)} – ${formatTime(before.endsAt)}`, NEW_TIME: `${formatTime(record.startsAt)} – ${formatTime(record.endsAt)}` }, customerAppUrl, transaction, key: `admin-time-${record.id}-${record.version}` });
        if (record.status === 'published' && before.locationId !== record.locationId) {
          const previous = before.locationId ? await models.Location.findByPk(before.locationId, { transaction }) : null;
          const current = record.locationId ? await models.Location.findByPk(record.locationId, { transaction }) : null;
          await queueEventEmail({ email, models, event: record, kind: 'venueChange', variables: { OLD_VENUE: venueName(previous), NEW_VENUE: venueName(current) }, customerAppUrl, transaction, key: `admin-venue-${record.id}-${record.version}` });
        }
      }
      return emailVerificationDelivery ? { ...after, emailVerificationDelivery } : after;
    });
  }
  return { update };
}
module.exports = { createAdminEditService, schemas };
