const { Op } = require('sequelize');
const { DomainError } = require('../domain/errors');

function isActiveWindow(record, now) {
  return record && record.status === 'active' && (!record.startsAt || record.startsAt <= now) && (!record.endsAt || record.endsAt >= now);
}

async function resolveAffiliate(models, { event, code, now = new Date(), transaction, lock }) {
  if (!code) return { commissionBps: 0, guestlistAllocation: 0, orgAffiliate: null, eventAffiliate: null };
  const common = { transaction, ...(lock ? { lock } : {}) };
  let eventAffiliate = await models.EventAffiliate.findOne({ where: { eventId: event.id, code }, ...common });
  let orgAffiliate = eventAffiliate?.orgAffiliateId ? await models.OrgAffiliate.findByPk(eventAffiliate.orgAffiliateId, common) : null;
  if (!eventAffiliate && event.organizationId) {
    orgAffiliate = await models.OrgAffiliate.findOne({ where: { organizationId: event.organizationId, code }, ...common });
    if (orgAffiliate) eventAffiliate = await models.EventAffiliate.findOne({ where: { eventId: event.id, userId: orgAffiliate.userId }, ...common });
  }
  if ((!eventAffiliate && !orgAffiliate) || (eventAffiliate && !isActiveWindow(eventAffiliate, now)) || (orgAffiliate && !isActiveWindow(orgAffiliate, now))) {
    throw new DomainError('Promoter code is invalid or inactive', { code: 'INVALID_AFFILIATE' });
  }
  return {
    eventAffiliate,
    orgAffiliate,
    commissionBps: eventAffiliate?.commissionBps ?? orgAffiliate?.defaultCommissionBps ?? 0,
    guestlistAllocation: eventAffiliate?.guestlistAllocation ?? orgAffiliate?.defaultGuestlistAllocation ?? 0,
  };
}
module.exports = { resolveAffiliate, isActiveWindow };
