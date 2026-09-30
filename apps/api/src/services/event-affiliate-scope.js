const { Op } = require('sequelize');
const { accessScope } = require('./event-affiliate-access');

// Automatic staff/leader assignments are only usable while the venue role
// that created them still exists. Explicit event-promoter assignments stand
// on their own and are governed by their active status.
async function activeEventAffiliates(models, assignments, memberships, employees, promoters = []) {
  const organizationScoped = assignments.filter((row) => accessScope(row) === 'organization');
  if (!organizationScoped.length) return assignments;
  const events = await models.Event.findAll({ where: { id: { [Op.in]: organizationScoped.map((row) => row.eventId) } }, attributes: ['id', 'organizationId'] });
  const organizationByEvent = new Map(events.map((event) => [event.id, event.organizationId]));
  const current = new Date();
  const activePromoters = promoters.filter((member) => (!member.startsAt || member.startsAt <= current) && (!member.endsAt || member.endsAt >= current));
  const organizationIds = new Set([...memberships, ...employees, ...activePromoters].map((member) => member.organizationId));
  return assignments.filter((row) => {
    return accessScope(row) === 'event' || organizationIds.has(organizationByEvent.get(row.eventId));
  });
}

module.exports = { activeEventAffiliates };
