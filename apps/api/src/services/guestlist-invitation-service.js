const crypto = require('node:crypto');
const { Op, Transaction } = require('sequelize');
const { createQrToken } = require('../domain/qr');
const { conflict, forbidden, notFound, DomainError } = require('../domain/errors');
const { assertGuestlistCapacity } = require('./guestlist-capacity');
const { createNotificationService } = require('./notification-service');

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const invitationsOpen = (event, at) => event?.status === 'published' && new Date(event.endsAt) > at;
function createGuestlistInvitationService({ sequelize, models, permissions, now = () => new Date() }) {
  const notifications = createNotificationService(models);
  async function pools(userId, eventId) {
    const scope = await permissions.guestlistReviewScope(userId, eventId);
    if (!invitationsOpen(scope.event, now())) return { direct: false, own: [], open: false };
    const affiliates = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' }, attributes: ['id', 'code', 'guestlistAllocation', 'startsAt', 'endsAt'], include: [{ model: models.OrgAffiliate, as: 'orgAffiliate', attributes: ['defaultGuestlistAllocation', 'status', 'startsAt', 'endsAt'], required: false }] });
    const current = now();
    return { direct: scope.canReviewAny, open: true, own: affiliates.filter((a) =>
      (scope.canReviewAny || scope.eventAffiliateIds.includes(a.id)) &&
      (!a.startsAt || a.startsAt <= current) && (!a.endsAt || a.endsAt >= current) &&
      (!a.orgAffiliate || (a.orgAffiliate.status === 'active' && (!a.orgAffiliate.startsAt || a.orgAffiliate.startsAt <= current) && (!a.orgAffiliate.endsAt || a.orgAffiliate.endsAt >= current))) &&
      (a.guestlistAllocation ?? a.orgAffiliate?.defaultGuestlistAllocation ?? 0) > 0
    ).map((a) => ({ id: a.id, guestlistAllocation: a.guestlistAllocation ?? a.orgAffiliate?.defaultGuestlistAllocation ?? 0 })) };
  }
  async function assertPool(userId, eventId, pool, eventAffiliateId) {
    const options = await pools(userId, eventId);
    if (!options.open) throw conflict('Guestlist invitations are closed for this event', 'GUESTLIST_CLOSED');
    if (pool === 'direct') {
      if (!options.direct || eventAffiliateId) throw forbidden('Direct guestlist access required');
      return null;
    }
    if (pool !== 'own' || !eventAffiliateId || !options.own.some((a) => a.id === eventAffiliateId)) throw forbidden('Your event guestlist allocation is required');
    return eventAffiliateId;
  }
  async function confirm(event, user, eventAffiliateId, partySize, actorId, transaction) {
    const existing = await models.GuestlistEntry.findOne({ where: { eventId: event.id, userId: user.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing) throw conflict('This customer already has a guestlist entry for the event', 'GUESTLIST_EXISTS');
    await assertGuestlistCapacity(models, event, eventAffiliateId, partySize, transaction, now());
    const qr = createQrToken();
    const entry = await models.GuestlistEntry.create({ eventId: event.id, userId: user.id, eventAffiliateId, source: eventAffiliateId ? 'affiliate' : 'event', partySize, status: 'pending' }, { transaction });
    await entry.update({ status: 'confirmed', qrTokenHash: qr.hash, reviewedByUserId: actorId, reviewedAt: now(), reviewNote: 'Invited by event team' }, { transaction });
    await models.AuditLog.create({ actorUserId: actorId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.invited_and_confirmed', after: { partySize: entry.partySize, eventAffiliateId } }, { transaction });
    await notifications.emit({ userId: user.id, eventId: event.id, kind: 'guestlist_invited', title: 'You are on the guestlist', message: `You have a confirmed guestlist place for ${event.title}.` }, transaction);
    return entry;
  }
  async function invite(userId, eventId, input) {
    const eventAffiliateId = await assertPool(userId, eventId, input.pool, input.eventAffiliateId);
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const event = await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      if (!invitationsOpen(event, now())) throw conflict('Guestlist invitations are closed for this event', 'GUESTLIST_CLOSED');
      const normalizedEmail = input.email?.toLowerCase() || null;
      const pending = await models.GuestlistInvitation.findOne({ where: { eventId, status: 'pending', ...(normalizedEmail ? { email: normalizedEmail } : { phone: input.phone }) }, transaction });
      if (pending && pending.expiresAt > now()) throw conflict('This guest already has a pending invitation for the event', 'INVITE_EXISTS');
      const phoneMatches = input.phone ? await models.User.findAll({ where: { phone: input.phone, phoneVerifiedAt: { [Op.ne]: null }, isActive: true }, limit: 2, transaction }) : [];
      const target = input.email
        ? await models.User.findOne({ where: { email: normalizedEmail, isActive: true }, transaction })
        : phoneMatches.length === 1 ? phoneMatches[0] : null;
      const token = crypto.randomBytes(32).toString('base64url');
      const invitation = await models.GuestlistInvitation.create({ eventId, invitedByUserId: userId, eventAffiliateId, email: normalizedEmail, phone: input.phone || null,
        tokenHash: hash(token), partySize: input.partySize, status: target ? 'accepted' : 'pending', expiresAt: new Date(now().getTime() + 7 * 86400000), acceptedAt: target ? now() : null, acceptedByUserId: target?.id || null }, { transaction });
      const entry = target ? await confirm(event, target, eventAffiliateId, input.partySize, userId, transaction) : null;
      await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'GuestlistInvitation', entityId: invitation.id, action: target ? 'guestlist.invite_existing' : 'guestlist.invite_created', after: { eventId, eventAffiliateId, partySize: input.partySize, contact: input.email ? 'email' : 'phone' } }, { transaction });
      return { invitation: { id: invitation.id, email: invitation.email, phone: invitation.phone, partySize: invitation.partySize, status: invitation.status, expiresAt: invitation.expiresAt }, entryId: entry?.id || null, token: target ? null : token };
    });
  }
  async function claim(token, userId, outerTransaction = null) {
    const run = async (transaction) => {
      const invitation = await models.GuestlistInvitation.findOne({ where: { tokenHash: hash(token) }, transaction, lock: transaction.LOCK.UPDATE });
      if (!invitation) throw new DomainError('Guestlist invitation is invalid or expired', { status: 404, code: 'INVITE_INVALID' });
      const user = await models.User.findByPk(userId, { transaction });
      if (!user || (invitation.email && user.email.toLowerCase() !== invitation.email) || (invitation.phone && user.phone !== invitation.phone)) throw forbidden('Sign in or register with the invited email or phone');
      if (invitation.status === 'accepted' && invitation.acceptedByUserId === userId) {
        const entry = await models.GuestlistEntry.findOne({ where: { eventId: invitation.eventId, userId }, transaction });
        return { status: ['confirmed', 'checked_in'].includes(entry?.status) ? 'confirmed' : 'unavailable', entryId: entry?.id || null, eventId: invitation.eventId };
      }
      if (invitation.status !== 'pending' || invitation.expiresAt <= now()) throw new DomainError('Guestlist invitation is invalid or expired', { status: 404, code: 'INVITE_INVALID' });
      const event = await models.Event.findByPk(invitation.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!invitationsOpen(event, now())) return { status: 'event_closed' };
      try {
        const entry = await confirm(event, user, invitation.eventAffiliateId, invitation.partySize, invitation.invitedByUserId, transaction);
        await invitation.update({ status: 'accepted', acceptedAt: now(), acceptedByUserId: user.id }, { transaction });
        return { status: 'confirmed', entryId: entry.id, eventId: event.id };
      } catch (error) {
        if (['GUESTLIST_FULL', 'AFFILIATE_GUESTLIST_FULL'].includes(error.code)) return { status: 'full', eventId: event.id };
        if (['INVALID_AFFILIATE', 'GUESTLIST_EXISTS'].includes(error.code)) return { status: 'unavailable', eventId: event.id };
        throw error;
      }
    };
    return outerTransaction ? run(outerTransaction) : sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, run);
  }
  return { pools, invite, claim };
}
module.exports = { createGuestlistInvitationService, invitationsOpen };
