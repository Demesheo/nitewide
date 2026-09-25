const { forbidden, notFound } = require('../domain/errors');
function createPermissionService(models) {
  async function canManageOrganization(userId, organizationId) {
    const [user, owner] = await Promise.all([models.User.findByPk(userId), models.OrganizationOwner.findOne({ where: { userId, organizationId } })]);
    return Boolean(user?.isInternalAdmin || owner);
  }
  async function assertManageOrganization(userId, organizationId) { if (!(await canManageOrganization(userId, organizationId))) throw forbidden('Organization owner access required'); }
  async function assertOwnOrganization(userId, organizationId) {
    const [user, membership] = await Promise.all([models.User.findByPk(userId), models.OrganizationOwner.findOne({ where: { userId, organizationId, role: 'owner' } })]);
    if (!user?.isInternalAdmin && !membership) throw forbidden('Organization owner access required');
  }
  async function assertManageEvent(userId, eventId) {
    const event = await models.Event.findByPk(eventId); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId);
    if (user?.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await canManageOrganization(userId, event.organizationId))) return event;
    throw forbidden('Event manager access required');
  }
  async function guestlistReviewScope(userId, eventId) {
    const event = await models.Event.findByPk(eventId); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId);
    if (!user?.isActive) throw forbidden('An active account is required');
    if (user?.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await canManageOrganization(userId, event.organizationId))) {
      return { event, canReviewAny: true, eventAffiliateIds: [] };
    }
    let affiliates = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' }, attributes: ['id', 'code'] });
    // A current venue leader already returned above; a former leader's automatic
    // referral record must not grant fresh guestlist approval access.
    affiliates = affiliates.filter((a) => !a.code?.startsWith('LEADEV-'));
    if (affiliates.some((a) => a.code?.startsWith('STAFFEV-'))) {
      const employee = await models.OrganizationEmployee.findOne({ where: { organizationId: event.organizationId, userId, status: 'active' } });
      if (!employee) affiliates = affiliates.filter((a) => !a.code?.startsWith('STAFFEV-'));
    }
    if (affiliates.length) return { event, canReviewAny: false, eventAffiliateIds: affiliates.map((affiliate) => affiliate.id) };
    throw forbidden('Guestlist approval access required');
  }
  async function assertGuestlistApprover(userId, eventId) { return (await guestlistReviewScope(userId, eventId)).event; }
  async function assertAdmitEvent(userId, eventId) {
    const event = await models.Event.findByPk(eventId);
    if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId);
    if (!user?.isActive) throw forbidden('An active account is required');
    if (user.isInternalAdmin || (!event.organizationId && event.creatorUserId === userId)) return event;
    if (event.organizationId) {
      const [leader, employee] = await Promise.all([
        models.OrganizationOwner.findOne({ where: { organizationId: event.organizationId, userId } }),
        models.OrganizationEmployee.findOne({ where: { organizationId: event.organizationId, userId, status: 'active' } }),
      ]);
      if (leader || employee) return event;
    }
    const assignments = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' }, attributes: ['id', 'code'] });
    if (assignments.some((a) => !a.code?.startsWith('STAFFEV-') && !a.code?.startsWith('LEADEV-'))) return event;
    throw forbidden('Active event team access is required for admissions');
  }
  async function assertInternal(userId) { const user = await models.User.findByPk(userId); if (!user?.isInternalAdmin) throw forbidden('Internal administrator access required'); return user; }
  return { canManageOrganization, assertManageOrganization, assertOwnOrganization, assertManageEvent, assertAdmitEvent, guestlistReviewScope, assertGuestlistApprover, assertInternal };
}
module.exports = { createPermissionService };
