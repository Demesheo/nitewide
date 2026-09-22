const { Op } = require('sequelize');
const { conflict, notFound } = require('../domain/errors');
const { resolveAffiliate } = require('./affiliate-service');

async function assertGuestlistCapacity(models, event, eventAffiliateId, partySize, transaction, at) {
  if (eventAffiliateId) {
    const affiliate = await models.EventAffiliate.findByPk(eventAffiliateId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!affiliate) throw notFound('Event promoter');
    const resolved = await resolveAffiliate(models, { event, code: affiliate.code, now: at, transaction, lock: transaction.LOCK.UPDATE });
    const used = Number(await models.GuestlistEntry.sum('partySize', { where: { eventAffiliateId, status: { [Op.in]: ['confirmed', 'checked_in'] } }, transaction })) || 0;
    if (used + partySize > resolved.guestlistAllocation) throw conflict('Promoter guestlist allocation reached', 'AFFILIATE_GUESTLIST_FULL');
  } else {
    const used = Number(await models.GuestlistEntry.sum('partySize', { where: { eventId: event.id, eventAffiliateId: null, status: { [Op.in]: ['confirmed', 'checked_in'] } }, transaction })) || 0;
    if (used + partySize > event.guestlistCapacity) throw conflict('Event direct guestlist capacity reached', 'GUESTLIST_FULL');
  }
}
module.exports = { assertGuestlistCapacity };
