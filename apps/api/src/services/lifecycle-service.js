const { forbidden, notFound, conflict } = require('../domain/errors');
const { Op } = require('sequelize');

const active = (record) => Boolean(record) && (!record.lifecycleState || record.lifecycleState === 'active');
const activeUser = (user) => active(user) && user.isActive !== false && !user.onboardingPending;
function activeEventScope(models, { locationAttributes = [], admission = false } = {}) {
  return {
    where: {
      lifecycleState: 'active',
      [Op.and]: [
        { [Op.or]: [{ organizationId: null }, { '$organization.id$': { [Op.ne]: null } }] },
        { [Op.or]: [{ locationId: null }, { '$location.id$': { [Op.ne]: null } }] },
        { [Op.or]: [{ organizationId: { [Op.ne]: null } }, { '$creator.id$': { [Op.ne]: null } }] },
      ],
    },
    include: [
      { model: models.Organization, as: 'organization', attributes: [], where: { lifecycleState: admission ? { [Op.in]: ['active', 'suspended'] } : 'active', status: admission ? { [Op.in]: ['active', 'suspended'] } : 'active' }, required: false },
      { model: models.Location, as: 'location', attributes: locationAttributes, where: { lifecycleState: 'active' }, required: false },
      { model: models.User, as: 'creator', attributes: [], where: { lifecycleState: 'active', isActive: true, onboardingPending: false }, required: false },
    ],
  };
}
function assertActiveUser(user) { if (!activeUser(user)) throw forbidden('An active, completed account is required'); return user; }
async function assertActiveOrganization(models, id, transaction) {
  const organization = await models.Organization.findByPk(id, { transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) });
  if (!organization) throw notFound('Organization');
  if (!active(organization) || organization.status !== 'active') throw forbidden('This organization is suspended or archived');
  return organization;
}
async function assertActiveEvent(models, event, transaction) {
  if (!event) throw notFound('Event');
  if (!active(event)) throw forbidden('This event is suspended or archived');
  if (event.organizationId) await assertActiveOrganization(models, event.organizationId, transaction);
  if (event.locationId) {
    const location = await models.Location.findByPk(event.locationId, { transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) });
    if (!active(location)) throw forbidden('This venue is suspended or archived');
  }
  const creator = !event.organizationId && event.creatorUserId ? await models.User.findByPk(event.creatorUserId, { transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) }) : null;
  if (creator && !activeUser(creator)) throw forbidden('The event creator is unavailable');
  return event;
}
// Suspending a merchant pauses new commerce, not already issued admission.
// Event cancellation/archive and unavailable physical venues still stop entry.
async function assertAdmissionEvent(models, event, transaction) {
  if (!event) throw notFound('Event');
  if (!active(event)) throw forbidden('This event is suspended or archived');
  if (event.organizationId) {
    const organization = await models.Organization.findByPk(event.organizationId, { transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) });
    if (!organization || organization.lifecycleState === 'archived' || organization.status === 'closed') throw forbidden('This organization is archived');
  }
  if (event.locationId) {
    const location = await models.Location.findByPk(event.locationId, { transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) });
    if (!active(location)) throw forbidden('This venue is suspended or archived');
  }
  if (!event.organizationId && event.creatorUserId) {
    const creator = await models.User.findByPk(event.creatorUserId, { transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) });
    if (creator && !activeUser(creator)) throw forbidden('The event creator is unavailable');
  }
  return event;
}
async function assertOrganizationVenue(models, organization, locationId, transaction) {
  if (!locationId) throw conflict('Select a saved venue for the event', 'ORGANIZATION_LOCATION_REQUIRED');
  if (models.OrganizationVenue) {
    const linked = await models.OrganizationVenue.findOne({ where: { organizationId: organization.id, locationId }, transaction });
    if (!linked) throw conflict('The venue must belong to this organization', 'VENUE_PARENT_MISMATCH');
  } else if (organization.locationId !== locationId) throw conflict('The venue must belong to this organization', 'VENUE_PARENT_MISMATCH');
  const location = await models.Location.findByPk(locationId, { transaction });
  if (!active(location)) throw conflict('Select an active venue', 'VENUE_INACTIVE');
  return location;
}
module.exports = { active, activeUser, activeEventScope, assertActiveUser, assertActiveOrganization, assertActiveEvent, assertAdmissionEvent, assertOrganizationVenue };
