const { Op } = require('sequelize');
const { accessScope, accessWindowCurrent } = require('./event-affiliate-access');
const { venueAssignmentCurrent } = require('./venue-access-policy');

// Automatic staff/leader assignments are only usable while the venue role
// that created them still exists. Explicit event-promoter assignments stand
// on their own and are governed by their active status.
async function activeEventAffiliates(models, assignments, memberships, employees, promoters = []) {
  assignments = assignments.filter((row) => accessWindowCurrent(row));
  const scoped = assignments.filter((row) => accessScope(row) !== 'event');
  if (!scoped.length) return assignments;
  const events = await models.Event.findAll({ where: { id: { [Op.in]: scoped.map((row) => row.eventId) } }, attributes: ['id', 'organizationId', 'locationId'] });
  const organizationByEvent = new Map(events.map((event) => [event.id, event.organizationId]));
  const current = new Date();
  const activePromoters = promoters.filter((member) => accessWindowCurrent(member, current));
  const organizationIds = new Set([...memberships, ...employees, ...activePromoters].map((member) => member.organizationId));
  const valid = [];
  for (const row of assignments) {
    if (accessScope(row) === 'event' || (accessScope(row) === 'organization' && organizationIds.has(organizationByEvent.get(row.eventId))) ||
        (accessScope(row) === 'venue' && await venueAssignmentCurrent(models, row, events.find((event) => event.id === row.eventId), undefined, { allowSuspendedOrganization: true }))) valid.push(row);
  }
  return valid;
}

module.exports = { activeEventAffiliates };
