const { Transaction } = require('sequelize');
const { createQrToken } = require('../domain/qr');
const { DomainError, notFound, conflict } = require('../domain/errors');
const { resolveAffiliate } = require('./affiliate-service');
const { assertGuestlistCapacity } = require('./guestlist-capacity');
const { createNotificationService } = require('./notification-service');

function createGuestlistService({ sequelize, models, now = () => new Date() }) {
  const notifications = createNotificationService(models);
  async function request(input) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      if (event.status !== 'published') throw new DomainError('Guestlist is not open', { code: 'GUESTLIST_CLOSED' });
      const requestedAt = now();
      const affiliate = await resolveAffiliate(models, { event, code: input.affiliateCode, now: requestedAt, transaction });
      if (input.affiliateCode) {
        if (!affiliate.eventAffiliate) throw new DomainError('Promoter must be selected for this event', { code: 'AFFILIATE_NOT_SELECTED' });
      }
      const entry = await models.GuestlistEntry.create({
        eventId: event.id, userId: input.userId, eventAffiliateId: affiliate.eventAffiliate?.id,
        source: input.affiliateCode ? 'affiliate' : 'event', partySize: input.partySize, status: 'pending', qrTokenHash: null,
      }, { transaction });
      await models.AffiliateAttribution.create({ eventId: event.id, userId: input.userId, orgAffiliateId: affiliate.orgAffiliate?.id, eventAffiliateId: affiliate.eventAffiliate?.id, action: 'guestlist', occurredAt: requestedAt, metadata: { status: 'requested' } }, { transaction });
      await models.AuditLog.create({ actorUserId: input.userId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.requested', after: { partySize: input.partySize, source: entry.source } }, { transaction });
      if (models.Notification) {
        const requester = await models.User.findByPk(input.userId, { transaction });
        const leaders = event.organizationId
          ? (await models.OrganizationOwner.findAll({ where: { organizationId: event.organizationId }, attributes: ['userId'], transaction })).map((row) => row.userId)
          : [event.creatorUserId];
        const reviewerIds = [affiliate.eventAffiliate?.userId, ...leaders];
        for (const reviewerId of new Set(reviewerIds.filter((id) => id && id !== input.userId))) await notifications.emit({ userId: reviewerId, eventId: event.id, kind: 'guestlist_request', title: 'Guestlist request', message: `${requester?.displayName || 'A customer'} requests ${input.partySize} ${input.partySize === 1 ? 'spot' : 'spots'} for ${event.title}.`, metadata: { entryId: entry.id, referrerUserId: affiliate.eventAffiliate?.userId || null } }, transaction);
      }
      return { entry, requiresApproval: true };
    });
  }

  async function review(input) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      const entry = await models.GuestlistEntry.findOne({ where: { id: input.entryId, eventId: event.id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!entry) throw notFound('Guestlist request');
      if (input.decision === 'cancel') {
        if (entry.status !== 'confirmed' || entry.checkedInAt) throw conflict('Only an approved, unused guestlist entry can have its approval revoked', 'GUESTLIST_NOT_CANCELLABLE');
        await entry.update({ status: 'rejected', qrTokenHash: null, reviewedByUserId: input.reviewedByUserId, reviewedAt: now(), reviewNote: input.note || null }, { transaction });
        await models.AuditLog.create({ actorUserId: input.reviewedByUserId, organizationId: event.organizationId,
          entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.approval_revoked',
          before: { status: 'confirmed', partySize: entry.partySize, eventAffiliateId: entry.eventAffiliateId },
          after: { status: 'rejected', note: input.note || null } }, { transaction });
        if (models.Notification) await notifications.emit({ userId: entry.userId, eventId: event.id, kind: 'guestlist_declined', title: 'Guestlist approval revoked', message: `Your guestlist approval for ${event.title} was revoked.`, metadata: { entryId: entry.id } }, transaction);
        return { entry, qrToken: null };
      }
      if (input.decision === 'approve' ? !['pending', 'rejected'].includes(entry.status) : entry.status !== 'pending') throw conflict('Guestlist request cannot be reviewed in its current state', 'GUESTLIST_ALREADY_REVIEWED');
      const reviewedAt = now();
      if (input.decision === 'reject') {
        await entry.update({ status: 'rejected', reviewedByUserId: input.reviewedByUserId, reviewedAt, reviewNote: input.note || null }, { transaction });
        await models.AuditLog.create({ actorUserId: input.reviewedByUserId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.rejected', after: { note: input.note || null } }, { transaction });
        if (models.Notification) await notifications.emit({ userId: entry.userId, eventId: event.id, kind: 'guestlist_declined', title: 'Guestlist request declined', message: `Your request for ${event.title} was declined.`, metadata: { entryId: entry.id } }, transaction);
        return { entry, qrToken: null };
      }

      await assertGuestlistCapacity(models, event, entry.eventAffiliateId, entry.partySize, transaction, reviewedAt);
      const qr = createQrToken();
      await entry.update({ status: 'confirmed', qrTokenHash: qr.hash, reviewedByUserId: input.reviewedByUserId, reviewedAt, reviewNote: input.note || null }, { transaction });
      await models.AuditLog.create({ actorUserId: input.reviewedByUserId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.approved', after: { partySize: entry.partySize } }, { transaction });
      if (models.Notification) await notifications.emit({ userId: entry.userId, eventId: event.id, kind: 'guestlist_approved', title: 'Guestlist approved', message: `You're on the guestlist for ${event.title}.`, metadata: { entryId: entry.id } }, transaction);
      return { entry, qrToken: qr.token };
    });
  }

  return { request, review };
}
module.exports = { createGuestlistService };
