const crypto = require('node:crypto');
const { Op } = require('sequelize');
const { createQrToken } = require('../domain/qr');
const { conflict, forbidden, notFound, DomainError } = require('../domain/errors');
const { assertGuestlistCapacity } = require('./guestlist-capacity');
const { createNotificationService } = require('./notification-service');
const { queueGuestlistEmail } = require('./email-events');
const { assertActiveEvent, activeUser } = require('./lifecycle-service');
const { canClaimInvitation } = require('./guestlist-invitation-policy');
const { mutationTransaction, authorizationFence } = require('./mutation-transaction');
const { invitationToken, invitationId, verifyInvitationToken } = require('../domain/guestlist-invitation-token');
const { issueGuestlistPasses, guestlistPassTickets } = require('./guestlist-pass-service');
const { ADMISSION_WINDOW_MS } = require('../domain/admission-policy');
const { assertAdmissionEvent } = require('./lifecycle-service');
const { eventSummary } = require('./customer-account-service');

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const invitationsOpen = (event, at) => event?.status === 'published' && new Date(event.endsAt) > at;
function createGuestlistInvitationService({ sequelize, models, permissions, email = null, customerAppUrl = 'http://localhost:5173', tokenSecret, now = () => new Date() }) {
  const notifications = createNotificationService(models);
  async function pools(userId, eventId, transaction) {
    const scope = await permissions.guestlistReviewScope(userId, eventId, transaction);
    if (!invitationsOpen(scope.event, now())) return { direct: false, own: [], open: false };
    const affiliates = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' }, transaction, attributes: ['id', 'code', 'guestlistAllocation', 'startsAt', 'endsAt'], include: [{ model: models.OrgAffiliate, as: 'orgAffiliate', attributes: ['defaultGuestlistAllocation', 'status', 'startsAt', 'endsAt'], required: false }] });
    const current = now();
    return { direct: scope.canReviewAny, open: true, own: affiliates.filter((a) =>
      (scope.canReviewAny || scope.eventAffiliateIds.includes(a.id)) &&
      (!a.startsAt || a.startsAt <= current) && (!a.endsAt || a.endsAt >= current) &&
      (!a.orgAffiliate || (a.orgAffiliate.status === 'active' && (!a.orgAffiliate.startsAt || a.orgAffiliate.startsAt <= current) && (!a.orgAffiliate.endsAt || a.orgAffiliate.endsAt >= current))) &&
      (a.guestlistAllocation ?? a.orgAffiliate?.defaultGuestlistAllocation ?? 0) > 0
    ).map((a) => ({ id: a.id, guestlistAllocation: a.guestlistAllocation ?? a.orgAffiliate?.defaultGuestlistAllocation ?? 0 })) };
  }
  async function assertPool(userId, eventId, pool, eventAffiliateId, transaction) {
    const options = await pools(userId, eventId, transaction);
    if (!options.open) throw conflict('Guestlist invitations are closed for this event', 'GUESTLIST_CLOSED');
    if (pool === 'direct') {
      if (!options.direct || eventAffiliateId) throw forbidden('Direct guestlist access required');
      return null;
    }
    if (pool !== 'own' || !eventAffiliateId || !options.own.some((a) => a.id === eventAffiliateId)) throw forbidden('Your event guestlist allocation is required');
    return eventAffiliateId;
  }
  async function confirm(event, user, eventAffiliateId, partySize, actorId, transaction, recipient = {}) {
    const existing = user && await models.GuestlistEntry.findOne({ where: { eventId: event.id, userId: user.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing) throw conflict('This customer already has a guestlist entry for the event', 'GUESTLIST_EXISTS');
    await assertGuestlistCapacity(models, event, eventAffiliateId, partySize, transaction, now());
    const qr = createQrToken();
    const entry = await models.GuestlistEntry.create({ eventId: event.id, userId: user?.id || null, eventAffiliateId,
      guestName: recipient.name || user?.displayName || 'Guest', guestEmail: recipient.email || user?.email || null, guestPhone: recipient.phone || user?.phone || null,
      source: eventAffiliateId ? 'affiliate' : 'event', partySize, status: 'confirmed', qrTokenHash: qr.hash,
      reviewedByUserId: actorId, reviewedAt: now(), reviewNote: 'Invited by event team' }, { transaction });
    await issueGuestlistPasses(models, entry, transaction);
    await models.AuditLog.create({ actorUserId: actorId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.invited_and_confirmed', after: { partySize: entry.partySize, eventAffiliateId } }, { transaction });
    if (user) {
      await notifications.emit({ userId: user.id, eventId: event.id, kind: 'guestlist_invited', title: 'You are on the guestlist', message: `You have ${partySize} confirmed guestlist ${partySize === 1 ? 'spot' : 'spots'} for ${event.title}.`, metadata: { entryId: entry.id } }, transaction);
      await queueGuestlistEmail({ email, models, entry, event, kind: 'approved', customerAppUrl, transaction });
    }
    return entry;
  }
  async function invite(userId, eventId, input, context = {}) {
    if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 20 || (!input.email && !input.phone && !input.name?.trim())) throw new DomainError('Enter a guest name and between 1 and 20 spots', { status: 422, code: 'INVALID_GUESTLIST_INVITATION' });
    return mutationTransaction(sequelize, async (transaction) => {
      const event = await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      if (context.beforeInvite) await context.beforeInvite(event, transaction);
      const eventAffiliateId = context.resolvePool ? await context.resolvePool(userId, eventId, input, transaction) : await assertPool(userId, eventId, input.pool, input.eventAffiliateId, transaction);
      await assertActiveEvent(models, event, transaction);
      if (!invitationsOpen(event, now())) throw conflict('Guestlist invitations are closed for this event', 'GUESTLIST_CLOSED');
      if (!await canClaimInvitation(models, { invitedByUserId: userId, eventAffiliateId }, event, transaction, now())) throw forbidden('Current guestlist invitation access is required');
      const normalizedEmail = input.email?.toLowerCase() || null;
      const pending = normalizedEmail || input.phone ? await models.GuestlistInvitation.findOne({ where: { eventId, status: { [Op.in]: ['pending','accepted'] }, ...(normalizedEmail ? { email: normalizedEmail } : { phone: input.phone }) }, transaction, order: [['createdAt','DESC']] }) : null;
      if (pending && pending.expiresAt > now()) {
        const prior = pending.guestlistEntryId && await models.GuestlistEntry.findByPk(pending.guestlistEntryId, { transaction });
        if (pending.status === 'pending' || !prior || ['confirmed','checked_in'].includes(prior.status)) throw conflict('This guest already has an invitation for the event', 'INVITE_EXISTS');
      }
      const phoneMatches = input.phone ? await models.User.findAll({ where: { phone: input.phone, phoneVerifiedAt: { [Op.ne]: null }, isActive: true }, limit: 2, transaction }) : [];
      const target = input.email
        ? await models.User.findOne({ where: { email: normalizedEmail, isActive: true }, transaction })
        : phoneMatches.length === 1 ? phoneMatches[0] : null;
      const token = crypto.randomBytes(32).toString('base64url');
      const entry = await confirm(event, target, eventAffiliateId, input.partySize, userId, transaction, { ...input, email: normalizedEmail });
      const invitation = await models.GuestlistInvitation.create({ eventId, invitedByUserId: userId, eventAffiliateId, email: normalizedEmail, phone: input.phone || null,
        name: entry.guestName, guestlistEntryId: entry.id, tokenHash: hash(token), partySize: input.partySize, status: 'accepted',
        expiresAt: new Date(+new Date(event.endsAt) + ADMISSION_WINDOW_MS), acceptedAt: now(), acceptedByUserId: target?.id || null }, { transaction });
      await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'GuestlistInvitation', entityId: invitation.id, action: target ? 'guestlist.invite_existing' : 'guestlist.invite_created', after: { eventId, eventAffiliateId, partySize: input.partySize, contact: input.email ? 'email' : input.phone ? 'phone' : 'personal', approved: true } }, { transaction });
      if (context.onCreated) await context.onCreated(invitation, event, transaction);
      return { invitation: { id: invitation.id, name: invitation.name, email: invitation.email, phone: invitation.phone, partySize: invitation.partySize, status: invitation.status, expiresAt: invitation.expiresAt }, entryId: entry.id, token: invitationToken(invitation, tokenSecret) };
    });
  }
  async function claim(token, userId, outerTransaction = null) {
    const run = async (transaction) => {
      await authorizationFence(sequelize, transaction);
      // Event → invitation matches issuance and prevents inverse-order deadlocks.
      const scope = await findInvitation(token, transaction);
      if (!scope) throw new DomainError('Guestlist invitation is invalid or expired', { status: 404, code: 'INVITE_INVALID' });
      const event = await models.Event.findByPk(scope.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      const invitation = await models.GuestlistInvitation.findOne({ where: { id: scope.id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!invitation) throw new DomainError('Guestlist invitation is invalid or expired', { status: 404, code: 'INVITE_INVALID' });
      if (invitationId(token) && !verifyInvitationToken(token, invitation, tokenSecret)) throw new DomainError('Guestlist invitation is invalid or expired', { status: 404, code: 'INVITE_INVALID' });
      const user = userId ? await models.User.findByPk(userId, { transaction }) : null;
      if (userId && (!activeUser(user) || (invitation.email && user.email.toLowerCase() !== invitation.email) || (invitation.phone && user.phone !== invitation.phone))) throw forbidden('Use the active invited email or phone to add this entry to your account');
      if (invitation.status === 'accepted') {
        const entry = invitation.guestlistEntryId ? await models.GuestlistEntry.findByPk(invitation.guestlistEntryId, { transaction, lock: transaction.LOCK.UPDATE }) : invitation.acceptedByUserId ? await models.GuestlistEntry.findOne({ where: { eventId: invitation.eventId, userId: invitation.acceptedByUserId }, transaction, lock: transaction.LOCK.UPDATE }) : null;
        // Linking is optional and explicit. Possessing a personal link never
        // silently assigns someone else's passes to the currently signed-in user.
        if (entry && user && !entry.userId && (invitation.email || invitation.phone)) {
          if (await models.GuestlistEntry.findOne({ where: { eventId: event.id, userId: user.id }, transaction })) throw conflict('Your account already has an entry for this event', 'GUESTLIST_EXISTS');
          await entry.update({ userId: user.id }, { transaction });
          await invitation.update({ acceptedByUserId: user.id, guestlistEntryId: entry.id }, { transaction });
        }
        if (entry && !invitation.guestlistEntryId) await invitation.update({ guestlistEntryId: entry.id }, { transaction });
        return { status: ['confirmed', 'checked_in'].includes(entry?.status) ? 'confirmed' : 'unavailable', entryId: entry?.id || null, eventId: invitation.eventId };
      }
      if (invitation.status !== 'pending' || invitation.expiresAt <= now()) throw new DomainError('Guestlist invitation is invalid or expired', { status: 404, code: 'INVITE_INVALID' });
      try { await assertActiveEvent(models, event, transaction); }
      catch (error) { if ([403, 404].includes(error.status)) return { status: 'event_closed', eventId: invitation.eventId }; throw error; }
      if (!invitationsOpen(event, now())) return { status: 'event_closed' };
      if (!await canClaimInvitation(models, invitation, event, transaction, now())) return { status: 'unavailable', eventId: event.id };
      try {
        const entry = await confirm(event, user, invitation.eventAffiliateId, invitation.partySize, invitation.invitedByUserId, transaction, { name: invitation.name, email: invitation.email, phone: invitation.phone });
        await invitation.update({ status: 'accepted', acceptedAt: now(), acceptedByUserId: user?.id || null, guestlistEntryId: entry.id }, { transaction });
        return { status: 'confirmed', entryId: entry.id, eventId: event.id };
      } catch (error) {
        if (['GUESTLIST_FULL', 'AFFILIATE_GUESTLIST_FULL'].includes(error.code)) return { status: 'full', eventId: event.id };
        if (['INVALID_AFFILIATE', 'GUESTLIST_EXISTS'].includes(error.code)) return { status: 'unavailable', eventId: event.id };
        throw error;
      }
    };
    return outerTransaction ? run(outerTransaction) : mutationTransaction(sequelize, run);
  }
  async function findInvitation(token, transaction) {
    const id = invitationId(token);
    const invitation = await models.GuestlistInvitation.findOne({ where: id ? { id } : { tokenHash: hash(token) }, transaction });
    if (!invitation || (id && !verifyInvitationToken(token, invitation, tokenSecret))) throw new DomainError('Guestlist invitation is invalid or expired', { status: 404, code: 'INVITE_INVALID' });
    return invitation;
  }
  async function pass(token) {
    const invitation = await findInvitation(token);
    if (invitation.status !== 'accepted' || !invitation.guestlistEntryId) throw new DomainError('Guestlist invitation is unavailable', { status: 404, code: 'INVITE_INVALID' });
    const entry = await models.GuestlistEntry.findByPk(invitation.guestlistEntryId, { include: [{ model: models.Event, as: 'event', include: [
      { model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id','name','planTier'] },
    ] }] });
    if (!entry) throw notFound('Guest list entry');
    let available = ['confirmed','checked_in'].includes(entry.status) && Boolean(entry.qrTokenHash) && entry.event.status === 'published' && +new Date(entry.event.endsAt) + ADMISSION_WINDOW_MS >= +now();
    if (available) try { await assertAdmissionEvent(models, entry.event); } catch (error) { if (![403,404].includes(error.status)) throw error; available = false; }
    return { id: entry.id, kind: 'guestlist', status: entry.status, guestName: entry.guestName || invitation.name || 'Guest',
      event: eventSummary(entry.event, { canViewAttendeeAddress: available }), partySize: entry.partySize,
      tickets: await guestlistPassTickets(models, entry, tokenSecret, available) };
  }
  async function link(userId, eventId, entryId, context = {}) {
    return mutationTransaction(sequelize, async transaction => {
      if (context.beforeLink) {
        const event = await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!event) throw notFound('Event');
        await context.beforeLink(event, transaction);
      }
      const scope = await permissions.guestlistReviewScope(userId, eventId, transaction);
      const entry = await models.GuestlistEntry.findOne({ where: { id: entryId, eventId }, transaction });
      if (!entry || (!scope.canReviewAny && !scope.eventAffiliateIds.includes(entry.eventAffiliateId))) throw notFound('Guest list entry');
      const invitation = await models.GuestlistInvitation.findOne({ where: { guestlistEntryId: entryId, status: 'accepted' }, transaction });
      if (!invitation || !['confirmed','checked_in'].includes(entry.status)) throw notFound('Guestlist invitation');
      return { token: invitationToken(invitation, tokenSecret) };
    });
  }
  return { pools, invite, claim, pass, link };
}
module.exports = { createGuestlistInvitationService, invitationsOpen };
