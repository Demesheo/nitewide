const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const { eventEditor } = require('../http/business-schemas');
const { conflict, notFound } = require('../domain/errors');

const adminEventInput = eventEditor.safeExtend({ adminReason: z.string().trim().min(10).max(500) });
const eventId = z.uuid();

function createAdminEventService({ models, permissions, business }) {
  const authorize = (actor, transaction) => permissions.assertInternalPermission
    ? permissions.assertInternalPermission(actor, 'events.manage', transaction)
    : permissions.assertInternal(actor, transaction);
  async function editor(actor, id) {
    await authorize(actor);
    const event = await models.Event.unscoped().findByPk(eventId.parse(id), { include: [
      { model: models.Location, as: 'location', required: false },
      { model: models.Offering, as: 'offerings', required: false },
      { model: models.Organization, as: 'organization', required: false },
    ] });
    if (!event) throw notFound('Event');
    const value = event.toJSON();
    value.isManagedVenue = Boolean(value.organizationId && value.locationId && await models.OrganizationVenue.findOne({ where: { organizationId: value.organizationId, locationId: value.locationId } }));
    value.offerings.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const organizations = value.organization ? [{ ...value.organization, canManage: true }] : [];
    const links = value.organizationId ? await models.OrganizationVenue.findAll({
      where: { organizationId: value.organizationId }, order: [['id', 'ASC']], limit: 100,
      include: [{ model: models.Location, as: 'location', required: true }],
    }) : [];
    const venues = links.map((link) => ({ id: link.id, organizationId: link.organizationId,
      label: link.location.name || link.location.city, locationIds: [link.locationId], location: link.location.toJSON(),
      managedLocationIds: [link.locationId], managedLocation: link.location.toJSON() }));
    return { event: value, organizations, venues };
  }
  async function options(actor, organizationId) {
    await authorize(actor);
    const organization = await models.Organization.unscoped().findByPk(eventId.parse(organizationId), {
      include: [{ model: models.Location, as: 'location', required: false }],
    });
    if (!organization) throw notFound('Business');
    const links = await models.OrganizationVenue.findAll({ where: { organizationId },
      include: [{ model: models.Location, as: 'location', required: true }], order: [['id', 'ASC']], limit: 100 });
    return { organizations: [{ ...organization.toJSON(), canManage: true }],
      venues: links.map((link) => ({ id: link.id, organizationId, label: link.location.name || link.location.city,
        locationIds: [link.locationId], location: link.location.toJSON(),
        managedLocationIds: [link.locationId], managedLocation: link.location.toJSON() })), defaultOrganization: organizationId };
  }
  async function save(actor, id, body) {
    await authorize(actor);
    const { adminReason, ...input } = adminEventInput.parse(body);
    let creatorUserId = null;
    if (!id) {
      if (!input.organizationId) throw conflict('Create a business workspace before creating its event.', 'BUSINESS_REQUIRED');
      const members = await models.OrganizationOwner.findAll({ where: { organizationId: input.organizationId,
        lifecycleState: 'active' }, include: [{ model: models.User, as: 'user', where: {
          isActive: true, lifecycleState: 'active', onboardingPending: false }, required: true }],
        order: [['createdAt', 'ASC'], ['id', 'ASC']], limit: 100 });
      creatorUserId = (members.find((member) => member.role === 'owner') || members[0])?.userId;
      if (!creatorUserId) throw conflict('The business needs an active owner or manager who has accepted access before creating events.', 'BUSINESS_CONTACT_REQUIRED');
    }
    return business.saveEvent(actor, id ? eventId.parse(id) : null, input, { adminReason, creatorUserId });
  }
  async function audience(actor, id) {
    await authorize(actor);
    if (!await models.Event.findByPk(eventId.parse(id))) throw notFound('Event');
    const [result] = await models.User.sequelize.query(`SELECT COUNT(DISTINCT audience.user_id)::int AS recipients
      FROM (SELECT buyer_user_id AS user_id FROM orders WHERE event_id=:eventId AND status='paid'
        UNION SELECT user_id FROM guestlist_entries WHERE event_id=:eventId AND status IN ('pending','confirmed','checked_in')) audience
      JOIN users u ON u.id=audience.user_id WHERE u.is_active=true AND u.email IS NOT NULL`,
    { replacements: { eventId: id }, type: QueryTypes.SELECT });
    return { recipients: Number(result?.recipients || 0),
      message: 'Cancellations and significant time or venue changes notify affected attendees. Refunds are a separate workflow.' };
  }
  return { editor, save, audience, options };
}
module.exports = { createAdminEventService, adminEventInput };
