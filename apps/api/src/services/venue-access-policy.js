const { active, activeUser } = require('./lifecycle-service');

function venueMemberSql(alias = 'e', roles) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias');
  if (roles && roles.some((role) => !['manager', 'employee', 'promoter'].includes(role))) throw new Error('Invalid venue role');
  // Callers also use this with organization_venues aliases. Never shadow the
  // outer alias, which would turn an exact-venue comparison into a tautology.
  const grant = `venue_grant_${alias}`, parent = `venue_parent_${alias}`;
  return `EXISTS (SELECT 1 FROM venue_access ${grant} JOIN organization_venues ${parent}
    ON ${parent}.organization_id = ${grant}.organization_id AND ${parent}.location_id = ${grant}.location_id
    WHERE ${grant}.organization_id = ${alias}.organization_id AND ${grant}.location_id = ${alias}.location_id
      AND ${grant}.user_id = :userId AND ${grant}.status = 'active'${roles ? ` AND ${grant}.role IN (${roles.map((role) => `'${role}'`).join(',')})` : ''})`;
}
const venueManagerSql = (alias = 'e') => venueMemberSql(alias, ['manager']);
async function currentVenueMembership(models, event, userId, transaction, { allowSuspendedOrganization = false } = {}) {
  if (!models.VenueAccess || !event?.organizationId || !event?.locationId) return null;
  const options = { transaction, ...(transaction ? { lock: transaction.LOCK.SHARE || 'SHARE' } : {}) };
  const user = await models.User.findByPk(userId, options);
  if (!activeUser(user)) return null;
  const organization = await models.Organization.findByPk(event.organizationId, options);
  if (!organization || organization.lifecycleState === 'archived' || organization.status === 'closed' || (!allowSuspendedOrganization && (!active(organization) || organization.status !== 'active'))) return null;
  const location = await models.Location.findByPk(event.locationId, options);
  if (!active(location)) return null;
  const linked = await models.OrganizationVenue.findOne({ where: { organizationId: event.organizationId, locationId: event.locationId }, ...options });
  if (!linked) return null;
  return models.VenueAccess.findOne({ where: { organizationId: event.organizationId, locationId: event.locationId, userId, status: 'active' }, ...options });
}
async function venueAssignmentCurrent(models, assignment, event, transaction, options) {
  const member = await currentVenueMembership(models, event, assignment.userId, transaction, options);
  return Boolean(member && member.id === assignment.venueAccessId);
}
module.exports = { venueMemberSql, venueManagerSql, currentVenueMembership, venueAssignmentCurrent };
