const { Op, Transaction } = require('sequelize');
const { createQrToken } = require('../domain/qr');
const { DomainError, notFound, conflict } = require('../domain/errors');
const { resolveAffiliate } = require('./affiliate-service');

function createGuestlistService({ sequelize, models, now = () => new Date() }) {
  return async function joinGuestlist(input) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      if (event.status !== 'published') throw new DomainError('Guestlist is not open', { code: 'GUESTLIST_CLOSED' });
      const used = Number(await models.GuestlistEntry.sum('partySize', { where: { eventId: event.id, status: { [Op.in]: ['confirmed', 'checked_in'] } }, transaction })) || 0;
      if (used + input.partySize > event.guestlistCapacity) throw conflict('Event guestlist capacity reached', 'GUESTLIST_FULL');
      const affiliate = await resolveAffiliate(models, { event, code: input.affiliateCode, now: now(), transaction, lock: transaction.LOCK.UPDATE });
      if (input.affiliateCode) {
        if (!affiliate.eventAffiliate) throw new DomainError('Affiliate must be selected for this event', { code: 'AFFILIATE_NOT_SELECTED' });
        const affiliateUsed = Number(await models.GuestlistEntry.sum('partySize', { where: { eventAffiliateId: affiliate.eventAffiliate.id, status: { [Op.in]: ['confirmed', 'checked_in'] } }, transaction })) || 0;
        if (affiliateUsed + input.partySize > affiliate.guestlistAllocation) throw conflict('Affiliate guestlist allocation reached', 'AFFILIATE_GUESTLIST_FULL');
      }
      const qr = createQrToken();
      const entry = await models.GuestlistEntry.create({ eventId: event.id, userId: input.userId, eventAffiliateId: affiliate.eventAffiliate?.id, source: input.affiliateCode ? 'affiliate' : 'event', partySize: input.partySize, qrTokenHash: qr.hash }, { transaction });
      await models.AffiliateAttribution.create({ eventId: event.id, userId: input.userId, orgAffiliateId: affiliate.orgAffiliate?.id, eventAffiliateId: affiliate.eventAffiliate?.id, action: 'guestlist', occurredAt: now() }, { transaction });
      return { entry, qrToken: qr.token };
    });
  };
}
module.exports = { createGuestlistService };

