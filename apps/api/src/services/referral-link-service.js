const { randomUUID } = require('node:crypto');
const { conflict, forbidden, notFound } = require('../domain/errors');
const { eventFinished } = require('../domain/event-policy');
const { employeeReferralCode, leaderReferralCode, resolveAffiliate } = require('./affiliate-service');

function createReferralLinkService({ models, now = () => new Date() }) {
  async function ownLink(userId, eventId) {
    const [event, user] = await Promise.all([models.Event.findByPk(eventId), models.User.findByPk(userId)]);
    if (!event) throw notFound('Event');
    if (!user?.isActive) throw forbidden('An active account is required');
    if (event.status !== 'published' || eventFinished(event, now())) throw conflict('This event is not accepting referrals', 'REFERRALS_CLOSED');
    return models.Event.sequelize.transaction(async (transaction) => {
      await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
      const assignment = await models.EventAffiliate.findOne({ where: { eventId, userId }, transaction, lock: transaction.LOCK.UPDATE });
      if (assignment?.status === 'inactive') throw forbidden('You were removed from this event');
      const leader = event.organizationId ? await models.OrganizationOwner.findOne({ where: { organizationId: event.organizationId, userId }, transaction }) : null;
      const employee = event.organizationId ? await models.OrganizationEmployee.findOne({ where: { organizationId: event.organizationId, userId, status: 'active' }, transaction }) : null;
      const orgAffiliate = event.organizationId ? await models.OrgAffiliate.findOne({ where: { organizationId: event.organizationId, userId, status: 'active' }, transaction }) : null;
      const independentCreator = !event.organizationId && event.creatorUserId === userId;
      const standalonePromoter = assignment && !assignment.code?.startsWith('LEADEV-') && !assignment.code?.startsWith('STAFFEV-');
      if (!leader && !employee && !orgAffiliate && !independentCreator && !standalonePromoter) throw forbidden('Event referral access required');
      if (assignment?.code?.startsWith('LEADEV-') && !leader || assignment?.code?.startsWith('STAFFEV-') && !employee) throw forbidden('Your venue role is no longer active');
      const code = assignment?.code || (leader ? leaderReferralCode(leader.id) : employee ? employeeReferralCode(employee.id) : null);
      if (code) {
        await resolveAffiliate(models, { event, code, now: now(), transaction });
        return { eventId, code, referrerName: user.displayName };
      }
      // Organization promoters and independent creators receive one stable
      // event assignment. An inactive assignment is never silently revived.
      const created = await models.EventAffiliate.create({ eventId, userId, orgAffiliateId: orgAffiliate?.id || null, code: `NW-${randomUUID()}`, commissionBps: independentCreator ? 0 : null, guestlistAllocation: independentCreator ? 0 : null, status: 'active' }, { transaction });
      return { eventId, code: created.code, referrerName: user.displayName };
    });
  }
  async function visit(eventId, code, sessionKey) {
    const event = await models.Event.findByPk(eventId);
    if (!event || event.status !== 'published' || eventFinished(event, now())) throw notFound('Active event');
    const affiliate = await resolveAffiliate(models, { event, code, now: now() });
    if (!affiliate.eventAffiliate) throw notFound('Active referral link');
    const referrer = await models.User.findByPk(affiliate.eventAffiliate.userId);
    if (!referrer?.isActive) throw notFound('Active referral link');
    if (sessionKey) {
      const where = { eventId, eventAffiliateId: affiliate.eventAffiliate.id, action: 'visit', sessionKey };
      const prior = await models.AffiliateAttribution.findOne({ where });
      if (!prior) await models.AffiliateAttribution.create({ ...where, occurredAt: now() });
    }
    return { eventId, referrerName: referrer.displayName, code };
  }
  return { ownLink, visit };
}
module.exports = { createReferralLinkService };
