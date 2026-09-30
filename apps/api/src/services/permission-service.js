const { forbidden, notFound } = require('../domain/errors');
const { activeUser, assertActiveOrganization, assertActiveEvent } = require('./lifecycle-service');
const { accessScope, currentOrganizationMembership } = require('./event-affiliate-access');
function createPermissionService(models) {
  async function canManageOrganization(userId, organizationId) {
    const [user, owner] = await Promise.all([models.User.findByPk(userId), models.OrganizationOwner.findOne({ where: { userId, organizationId, lifecycleState: 'active' } })]);
    if (!activeUser(user)) return false;
    if (user.isInternalAdmin) return true;
    await assertActiveOrganization(models, organizationId);
    return Boolean(owner);
  }
  async function assertManageOrganization(userId, organizationId) { if (!(await canManageOrganization(userId, organizationId))) throw forbidden('Organization owner access required'); }
  async function assertOwnOrganization(userId, organizationId) {
    const [user, membership] = await Promise.all([models.User.findByPk(userId), models.OrganizationOwner.findOne({ where: { userId, organizationId, role: 'owner', lifecycleState: 'active' } })]);
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!user.isInternalAdmin) await assertActiveOrganization(models, organizationId);
    if (!user?.isInternalAdmin && !membership) throw forbidden('Organization owner access required');
  }
  async function assertManageEvent(userId, eventId) {
    const event = await models.Event.findByPk(eventId); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId);
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!user.isInternalAdmin) await assertActiveEvent(models, event);
    if (user?.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await canManageOrganization(userId, event.organizationId))) return event;
    throw forbidden('Event manager access required');
  }
  async function guestlistReviewScope(userId, eventId) {
    const event = await models.Event.findByPk(eventId); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId);
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!user.isInternalAdmin) await assertActiveEvent(models, event);
    if (user?.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await canManageOrganization(userId, event.organizationId))) {
      return { event, canReviewAny: true, eventAffiliateIds: [] };
    }
    let affiliates = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' } });
    const member = await currentOrganizationMembership(models, event.organizationId, userId);
    affiliates = affiliates.filter((a) => accessScope(a) === 'event' || member);
    if (affiliates.length) return { event, canReviewAny: false, eventAffiliateIds: affiliates.map((affiliate) => affiliate.id) };
    throw forbidden('Guestlist approval access required');
  }
  async function assertGuestlistApprover(userId, eventId) { return (await guestlistReviewScope(userId, eventId)).event; }
  async function assertAdmitEvent(userId, eventId) {
    const event = await models.Event.findByPk(eventId);
    if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId);
    if (!activeUser(user)) throw forbidden('An active account is required');
    await assertActiveEvent(models, event);
    if (user.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId)) return event;
    if (event.organizationId) {
      const [leader, employee] = await Promise.all([
        models.OrganizationOwner.findOne({ where: { organizationId: event.organizationId, userId, lifecycleState: 'active' } }),
        models.OrganizationEmployee.findOne({ where: { organizationId: event.organizationId, userId, status: 'active' } }),
      ]);
      if (leader || employee) return event;
    }
    const assignments = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' } });
    if (assignments.some((a) => accessScope(a) === 'event' || Boolean(event.organizationId))) {
      if (assignments.some((a) => accessScope(a) === 'event') || await currentOrganizationMembership(models, event.organizationId, userId)) return event;
    }
    throw forbidden('Active event team access is required for admissions');
  }
  async function assertInternal(userId) { const user = await models.User.findByPk(userId); if (!activeUser(user) || !user.isInternalAdmin) throw forbidden('Internal administrator access required'); return user; }
  return { canManageOrganization, assertManageOrganization, assertOwnOrganization, assertManageEvent, assertAdmitEvent, guestlistReviewScope, assertGuestlistApprover, assertInternal };
}
module.exports = { createPermissionService };
