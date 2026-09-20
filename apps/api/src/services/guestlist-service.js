const { Op, Transaction } = require('sequelize');
const { createQrToken } = require('../domain/qr');
const { DomainError, notFound, conflict } = require('../domain/errors');
const { resolveAffiliate } = require('./affiliate-service');

function createGuestlistService({ sequelize, models, now = () => new Date() }) {
  async function request(input) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const event = await models.Event.findByPk(input.eventId, { transaction });
      if (!event) throw notFound('Event');
      if (event.status !== 'published') throw new DomainError('Guestlist is not open', { code: 'GUESTLIST_CLOSED' });
      const requestedAt = now();
      const affiliate = await resolveAffiliate(models, { event, code: input.affiliateCode, now: requestedAt, transaction });
      if (input.affiliateCode) {
        if (!affiliate.eventAffiliate) throw new DomainError('Affiliate must be selected for this event', { code: 'AFFILIATE_NOT_SELECTED' });
      }
      const entry = await models.GuestlistEntry.create({
        eventId: event.id, userId: input.userId, eventAffiliateId: affiliate.eventAffiliate?.id,
        source: input.affiliateCode ? 'affiliate' : 'event', partySize: input.partySize, status: 'pending', qrTokenHash: null,
      }, { transaction });
      await models.AffiliateAttribution.create({ eventId: event.id, userId: input.userId, orgAffiliateId: affiliate.orgAffiliate?.id, eventAffiliateId: affiliate.eventAffiliate?.id, action: 'guestlist', occurredAt: requestedAt, metadata: { status: 'requested' } }, { transaction });
      await models.AuditLog.create({ actorUserId: input.userId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.requested', after: { partySize: input.partySize, source: entry.source } }, { transaction });
      return { entry, requiresApproval: true };
    });
  }

  async function review(input) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      const entry = await models.GuestlistEntry.findOne({ where: { id: input.entryId, eventId: event.id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!entry) throw notFound('Guestlist request');
      if (entry.status !== 'pending') throw conflict('Guestlist request has already been reviewed', 'GUESTLIST_ALREADY_REVIEWED');
      const reviewedAt = now();
      if (input.decision === 'reject') {
        await entry.update({ status: 'rejected', reviewedByUserId: input.reviewedByUserId, reviewedAt, reviewNote: input.note || null }, { transaction });
        await models.AuditLog.create({ actorUserId: input.reviewedByUserId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.rejected', after: { note: input.note || null } }, { transaction });
        return { entry, qrToken: null };
      }

      if (entry.eventAffiliateId) {
        const eventAffiliate = await models.EventAffiliate.findByPk(entry.eventAffiliateId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!eventAffiliate) throw notFound('Event affiliate');
        const affiliate = await resolveAffiliate(models, { event, code: eventAffiliate.code, now: reviewedAt, transaction, lock: transaction.LOCK.UPDATE });
        const affiliateUsed = Number(await models.GuestlistEntry.sum('partySize', { where: { eventAffiliateId: entry.eventAffiliateId, status: { [Op.in]: ['confirmed', 'checked_in'] } }, transaction })) || 0;
        if (affiliateUsed + entry.partySize > affiliate.guestlistAllocation) throw conflict('Affiliate guestlist allocation reached', 'AFFILIATE_GUESTLIST_FULL');
      } else {
        const directUsed = Number(await models.GuestlistEntry.sum('partySize', { where: { eventId: event.id, eventAffiliateId: null, status: { [Op.in]: ['confirmed', 'checked_in'] } }, transaction })) || 0;
        if (directUsed + entry.partySize > event.guestlistCapacity) throw conflict('Event direct guestlist capacity reached', 'GUESTLIST_FULL');
      }
      const qr = createQrToken();
      await entry.update({ status: 'confirmed', qrTokenHash: qr.hash, reviewedByUserId: input.reviewedByUserId, reviewedAt, reviewNote: input.note || null }, { transaction });
      await models.AuditLog.create({ actorUserId: input.reviewedByUserId, organizationId: event.organizationId, entityType: 'GuestlistEntry', entityId: entry.id, action: 'guestlist.approved', after: { partySize: entry.partySize } }, { transaction });
      return { entry, qrToken: qr.token };
    });
  }

  return { request, review };
}
module.exports = { createGuestlistService };
