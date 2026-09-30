const { forbidden, notFound } = require('../domain/errors');
const { activeUser, assertActiveOrganization, assertActiveEvent } = require('./lifecycle-service');
const { accessScope, currentOrganizationMembership } = require('./event-affiliate-access');
function createPermissionService(models) {
  const options = (transaction) => ({ transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) });
  async function canManageOrganization(userId, organizationId, transaction) {
    const user = await models.User.findByPk(userId, options(transaction));
    const owner = await models.OrganizationOwner.findOne({ where: { userId, organizationId, lifecycleState: 'active' }, ...options(transaction) });
    if (!activeUser(user)) return false;
    if (user.isInternalAdmin) return true;
    await assertActiveOrganization(models, organizationId, transaction);
    return Boolean(owner);
  }
  async function assertManageOrganization(userId, organizationId, transaction) { if (!(await canManageOrganization(userId, organizationId, transaction))) throw forbidden('Organization owner access required'); }
  async function assertOwnOrganization(userId, organizationId, transaction) {
    const user = await models.User.findByPk(userId, options(transaction));
    const membership = await models.OrganizationOwner.findOne({ where: { userId, organizationId, role: 'owner', lifecycleState: 'active' }, ...options(transaction) });
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!user.isInternalAdmin) await assertActiveOrganization(models, organizationId, transaction);
    if (!user?.isInternalAdmin && !membership) throw forbidden('Organization owner access required');
  }
  async function assertManageEvent(userId, eventId, transaction) {
    const event = await models.Event.findByPk(eventId, options(transaction)); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId, options(transaction));
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!user.isInternalAdmin) await assertActiveEvent(models, event, transaction);
    if (user?.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await canManageOrganization(userId, event.organizationId, transaction))) return event;
    throw forbidden('Event manager access required');
  }
  async function guestlistReviewScope(userId, eventId, transaction) {
    const event = await models.Event.findByPk(eventId, options(transaction)); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId, options(transaction));
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!user.isInternalAdmin) await assertActiveEvent(models, event, transaction);
    if (user?.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await canManageOrganization(userId, event.organizationId, transaction))) {
      return { event, canReviewAny: true, eventAffiliateIds: [] };
    }
    let affiliates = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' }, order: [['id', 'ASC']], ...options(transaction) });
    const member = await currentOrganizationMembership(models, event.organizationId, userId, transaction);
    affiliates = affiliates.filter((a) => accessScope(a) === 'event' || member);
    if (affiliates.length) return { event, canReviewAny: false, eventAffiliateIds: affiliates.map((affiliate) => affiliate.id) };
    throw forbidden('Guestlist approval access required');
  }
  async function assertGuestlistApprover(userId, eventId, transaction) { return (await guestlistReviewScope(userId, eventId, transaction)).event; }
  async function assertAdmitEvent(userId, eventId, transaction) {
    const event = await models.Event.findByPk(eventId, options(transaction));
    if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId, options(transaction));
    if (!activeUser(user)) throw forbidden('An active account is required');
    await assertActiveEvent(models, event, transaction);
    if (user.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId)) return event;
    if (event.organizationId) {
      const leader = await models.OrganizationOwner.findOne({ where: { organizationId: event.organizationId, userId, lifecycleState: 'active' }, ...options(transaction) });
      const employee = await models.OrganizationEmployee.findOne({ where: { organizationId: event.organizationId, userId, status: 'active' }, ...options(transaction) });
      if (leader || employee) return event;
    }
    const assignments = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' }, order: [['id', 'ASC']], ...options(transaction) });
    if (assignments.some((a) => accessScope(a) === 'event' || Boolean(event.organizationId))) {
      if (assignments.some((a) => accessScope(a) === 'event') || await currentOrganizationMembership(models, event.organizationId, userId, transaction)) return event;
    }
    throw forbidden('Active event team access is required for admissions');
  }
  async function assertInternal(userId, transaction) { const user = await models.User.findByPk(userId, options(transaction)); if (!activeUser(user) || !user.isInternalAdmin) throw forbidden('Internal administrator access required'); return user; }
  return { canManageOrganization, assertManageOrganization, assertOwnOrganization, assertManageEvent, assertAdmitEvent, guestlistReviewScope, assertGuestlistApprover, assertInternal };
}
module.exports = { createPermissionService };
