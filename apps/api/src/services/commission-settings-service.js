const { notFound } = require('../domain/errors');
const { commissionMinimum, effectiveCommissionMinimum, MINIMUM_COMMISSION_SUBTOTAL_CENTS } = require('../domain/commission-policy');
const { mutationTransaction } = require('./mutation-transaction');
const { assertEventEditable } = require('../domain/event-policy');
const { activeUser } = require('./lifecycle-service');
const { individualCommissionContext } = require('./commission-profile-repository');
const { commissionTerms } = require('../domain/commission-eligibility');
const { assertCommissionPricing } = require('../domain/editor-pricing-policy');
function createCommissionSettingsService({ models, permissions, stripe = null, now = () => new Date() }) {
  const result = (organization, event) => ({ organizationId: organization?.id || event?.organizationId || null,
    ...(event ? { eventId: event.id } : {}), minimumSubtotalCents: event ? event.commissionMinimumSubtotalCents ?? null : organization.commissionMinimumSubtotalCents,
    effectiveMinimumSubtotalCents: effectiveCommissionMinimum(event, organization), floorSubtotalCents: MINIMUM_COMMISSION_SUBTOTAL_CENTS, appliesTo: 'future_orders' });
  async function organization(userId, organizationId, input) {
    const work = async (transaction) => {
      await permissions.assertManageOrganization(userId, organizationId, transaction);
      const org = await models.Organization.findByPk(organizationId, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
      if (!org) throw notFound('Organization');
      if (input) {
        const before = result(org);
        await org.update({ commissionMinimumSubtotalCents: commissionMinimum(input.minimumSubtotalCents) }, { transaction });
        await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'Organization', entityId: organizationId,
          action: 'commission.minimum.updated', before, after: result(org) }, { transaction });
      }
      return result(org);
    };
    return input ? mutationTransaction(models.Organization.sequelize, work, { accessChange: true }) : work();
  }
  async function event(userId, eventId, input) {
    const work = async (transaction) => {
      await permissions.assertManageEvent(userId, eventId, transaction);
      const saved = await models.Event.findByPk(eventId, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
      if (!saved) throw notFound('Event');
      const org = saved.organizationId ? await models.Organization.findByPk(saved.organizationId, { transaction }) : null;
      if (input) {
        assertEventEditable(saved, now());
        const before = result(org, saved);
        await saved.update({ commissionMinimumSubtotalCents: input.minimumSubtotalCents === null ? null : commissionMinimum(input.minimumSubtotalCents) }, { transaction });
        await models.AuditLog.create({ actorUserId: userId, organizationId: saved.organizationId, entityType: 'Event', entityId: eventId,
          action: 'commission.minimum.updated', before, after: result(org, saved) }, { transaction });
      }
      return result(org, saved);
    };
    return input ? mutationTransaction(models.Event.sequelize, work) : work();
  }
  async function personRate(userId, organizationId, personUserId, input) {
    return mutationTransaction(models.Organization.sequelize, async (transaction) => {
      await permissions.assertManageOrganization(userId, organizationId, transaction);
      await permissions.assertManageFinance(userId, organizationId, transaction);
      const org = await models.Organization.findByPk(organizationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!org) throw notFound('Organization');
      const person = await models.User.findByPk(personUserId, { transaction });
      if (!activeUser(person)) throw notFound('Active user');
      const affiliate = await models.OrgAffiliate.findOne({ where: { organizationId, userId: personUserId, status: 'active' }, transaction, lock: transaction.LOCK.UPDATE });
      if (!affiliate) throw notFound('Active organization referrer');
      const commissionContext = await individualCommissionContext(models, personUserId, { transaction, now: now(), mode: stripe?.mode || 'disabled' });
      await assertCommissionPricing({ models, organizationId, commissionBps: input.defaultCommissionBps, commissionContext, transaction, now: now() });
      const before = { defaultCommissionBps: affiliate.defaultCommissionBps };
      await affiliate.update({ defaultCommissionBps: input.defaultCommissionBps }, { transaction });
      const after = { organizationId, userId: personUserId, defaultCommissionBps: affiliate.defaultCommissionBps,
        ...commissionTerms(affiliate.defaultCommissionBps, commissionContext), appliesTo: 'future_orders' };
      await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'OrgAffiliate', entityId: affiliate.id,
        action: 'commission.default_rate.updated', before, after }, { transaction });
      return after;
    }, { accessChange: true });
  }
  return { organization, event, personRate };
}
module.exports = { createCommissionSettingsService };
