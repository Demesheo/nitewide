const { forbidden, notFound } = require('../domain/errors');
const { activeUser, assertActiveOrganization, assertActiveEvent, assertAdmissionEvent } = require('./lifecycle-service');
const { accessScope, accessWindowCurrent, currentOrganizationMembership } = require('./event-affiliate-access');
const { hasInternalPermission, INTERNAL_ADMIN_PERMISSIONS, internalAdminRole } = require('./internal-admin-permissions');
const { currentVenueMembership } = require('./venue-access-policy');
function createPermissionService(models) {
  const options = (transaction) => ({ transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) });
  async function canManageOrganization(userId, organizationId, transaction) {
    const user = await models.User.findByPk(userId, options(transaction));
    const owner = await models.OrganizationOwner.findOne({ where: { userId, organizationId, lifecycleState: 'active' }, ...options(transaction) });
    if (!activeUser(user)) return false;
    if (hasInternalPermission(user, 'access.manage')) return true;
    await assertActiveOrganization(models, organizationId, transaction);
    return Boolean(owner);
  }
  async function assertManageOrganization(userId, organizationId, transaction) { if (!(await canManageOrganization(userId, organizationId, transaction))) throw forbidden('Organization owner access required'); }
  async function assertOwnOrganization(userId, organizationId, transaction) {
    const user = await models.User.findByPk(userId, options(transaction));
    const membership = await models.OrganizationOwner.findOne({ where: { userId, organizationId, role: 'owner', lifecycleState: 'active' }, ...options(transaction) });
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!hasInternalPermission(user, 'access.manage')) await assertActiveOrganization(models, organizationId, transaction);
    if (!hasInternalPermission(user, 'access.manage') && !membership) throw forbidden('Organization owner access required');
  }
  async function assertManageEvent(userId, eventId, transaction) {
    const event = await models.Event.findByPk(eventId, options(transaction)); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId, options(transaction));
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!hasInternalPermission(user, 'events.manage')) await assertActiveEvent(models, event, transaction);
    if (hasInternalPermission(user, 'events.manage') || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await canManageOrganization(userId, event.organizationId, transaction))) return event;
    if ((await currentVenueMembership(models, event, userId, transaction))?.role === 'manager') return event;
    throw forbidden('Event manager access required');
  }
  async function assertCreateEvent(userId, organizationId, locationId, transaction) {
    const user = await models.User.findByPk(userId, options(transaction));
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (hasInternalPermission(user, 'events.manage')) return;
    if (!organizationId) { if (user.independentCreator) return; throw forbidden('Business event creation access required'); }
    await assertActiveOrganization(models, organizationId, transaction);
    if (await canManageOrganization(userId, organizationId, transaction)) return;
    if ((await currentVenueMembership(models, { organizationId, locationId }, userId, transaction))?.role === 'manager') return;
    throw forbidden('An organization leader or manager for this exact venue is required');
  }
  async function guestlistReviewScope(userId, eventId, transaction) {
    const event = await models.Event.findByPk(eventId, options(transaction)); if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId, options(transaction));
    if (!activeUser(user)) throw forbidden('An active account is required');
    if (!hasInternalPermission(user, 'events.manage')) await assertActiveEvent(models, event, transaction);
    if (hasInternalPermission(user, 'events.manage') || (!event.organizationId && event.creatorUserId === userId) || (event.organizationId && await canManageOrganization(userId, event.organizationId, transaction)) || (await currentVenueMembership(models, event, userId, transaction))?.role === 'manager') {
      return { event, canReviewAny: true, eventAffiliateIds: [] };
    }
    let affiliates = await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' }, order: [['id', 'ASC']], ...options(transaction) });
    const member = await currentOrganizationMembership(models, event.organizationId, userId, transaction);
    const venueMember = await currentVenueMembership(models, event, userId, transaction);
    affiliates = affiliates.filter((a) => accessWindowCurrent(a) && (accessScope(a) === 'event' || (accessScope(a) === 'venue' ? venueMember?.id === a.venueAccessId : member)));
    if (affiliates.length) return { event, canReviewAny: false, eventAffiliateIds: affiliates.map((affiliate) => affiliate.id) };
    throw forbidden('Guestlist approval access required');
  }
  async function assertGuestlistApprover(userId, eventId, transaction) { return (await guestlistReviewScope(userId, eventId, transaction)).event; }
  async function assertAdmitEvent(userId, eventId, transaction) {
    const event = await models.Event.findByPk(eventId, options(transaction));
    if (!event) throw notFound('Event');
    const user = await models.User.findByPk(userId, options(transaction));
    if (!activeUser(user)) throw forbidden('An active account is required');
    await assertAdmissionEvent(models, event, transaction);
    if (hasInternalPermission(user, 'events.manage') || (!event.organizationId && event.creatorUserId === userId)) return event;
    if (event.organizationId) {
      const leader = await models.OrganizationOwner.findOne({ where: { organizationId: event.organizationId, userId, lifecycleState: 'active' }, ...options(transaction) });
      const employee = await models.OrganizationEmployee.findOne({ where: { organizationId: event.organizationId, userId, status: 'active' }, ...options(transaction) });
      if (leader || employee) return event;
    }
    if (await currentVenueMembership(models, event, userId, transaction, { allowSuspendedOrganization: true })) return event;
    const assignments = (await models.EventAffiliate.findAll({ where: { eventId, userId, status: 'active' }, order: [['id', 'ASC']], ...options(transaction) })).filter((a) => accessWindowCurrent(a));
    if (assignments.some((a) => accessScope(a) === 'event' || Boolean(event.organizationId))) {
      if (assignments.some((a) => accessScope(a) === 'event') || await currentOrganizationMembership(models, event.organizationId, userId, transaction)) return event;
    }
    throw forbidden('Active event team access is required for admissions');
  }
  async function canManageFinance(userId, organizationId, transaction) {
    const user = await models.User.findByPk(userId, options(transaction));
    if (!activeUser(user)) return false;
    await assertActiveOrganization(models, organizationId, transaction);
    if (hasInternalPermission(user, 'finance.manage')) return true;
    const membership = await models.OrganizationOwner.findOne({ where: { userId, organizationId, lifecycleState: 'active' }, ...options(transaction) });
    return Boolean(membership && (membership.role === 'owner' || (membership.role === 'admin' && membership.financeAuthorized)));
  }
  async function assertManageFinance(userId, organizationId, transaction) { if (!await canManageFinance(userId, organizationId, transaction)) throw forbidden('Owner or finance-authorized manager access required'); }
  async function assertInternalIdentity(userId, transaction) { const user = await models.User.findByPk(userId, options(transaction)); if (!activeUser(user) || !user.isInternalAdmin) throw forbidden('Internal administrator access required'); return user; }
  async function assertInternalPermission(userId, permission, transaction) { const user = await assertInternalIdentity(userId, transaction); if (!hasInternalPermission(user, permission)) throw forbidden(`Internal ${permission} permission required`); return user; }
  async function assertInternal(userId, transaction) { return assertInternalPermission(userId, 'access.manage', transaction); }
  return { canManageOrganization, assertManageOrganization, assertOwnOrganization, assertManageEvent, assertCreateEvent, assertAdmitEvent, guestlistReviewScope, assertGuestlistApprover, assertInternal, assertInternalIdentity, assertInternalPermission, canManageFinance, assertManageFinance };
}
module.exports = { createPermissionService, INTERNAL_ADMIN_PERMISSIONS, hasInternalPermission, internalAdminRole };
