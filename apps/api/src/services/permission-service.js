const { forbidden, notFound } = require('../domain/errors');
function createPermissionService(models) {
  async function canManageOrganization(userId, organizationId) {
    const [user, owner] = await Promise.all([models.User.findByPk(userId), models.OrganizationOwner.findOne({ where: { userId, organizationId } })]);
    return Boolean(user?.isInternalAdmin || owner);
  }
  async function assertManageOrganization(userId, organizationId) { if (!(await canManageOrganization(userId, organizationId))) throw forbidden('Organization owner access required'); }
  async function assertManageEvent(userId, eventId) {
    const event = await models.Event.findByPk(eventId); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId);
    if (user?.isInternalAdmin || event.creatorUserId === userId || (event.organizationId && await canManageOrganization(userId, event.organizationId))) return event;
    throw forbidden('Event manager access required');
  }
  async function assertGuestlistApprover(userId, eventId) {
    const event = await models.Event.findByPk(eventId); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId);
    if (user?.isInternalAdmin || event.creatorUserId === userId || (event.organizationId && await canManageOrganization(userId, event.organizationId))) return event;
    const [eventAffiliate, orgAffiliate] = await Promise.all([
      models.EventAffiliate.findOne({ where: { eventId, userId, status: 'active' } }),
      event.organizationId ? models.OrgAffiliate.findOne({ where: { organizationId: event.organizationId, userId, status: 'active' } }) : null,
    ]);
    if (eventAffiliate || orgAffiliate) return event;
    throw forbidden('Guestlist approval access required');
  }
  async function assertInternal(userId) { const user = await models.User.findByPk(userId); if (!user?.isInternalAdmin) throw forbidden('Internal administrator access required'); return user; }
  return { canManageOrganization, assertManageOrganization, assertManageEvent, assertGuestlistApprover, assertInternal };
}
module.exports = { createPermissionService };
