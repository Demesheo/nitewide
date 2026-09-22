const { Op } = require('sequelize');

// Automatic staff/leader assignments are only usable while the venue role
// that created them still exists. Explicit event-promoter assignments stand
// on their own and are governed by their active status.
async function activeEventAffiliates(models, assignments, memberships, employees) {
  const automatic = assignments.filter((row) => row.code?.startsWith('STAFFEV-') || row.code?.startsWith('LEADEV-'));
  if (!automatic.length) return assignments;
  const events = await models.Event.findAll({ where: { id: { [Op.in]: automatic.map((row) => row.eventId) } }, attributes: ['id', 'organizationId'] });
  const organizationByEvent = new Map(events.map((event) => [event.id, event.organizationId]));
  return assignments.filter((row) => {
    if (row.code?.startsWith('STAFFEV-')) return employees.some((member) => member.organizationId === organizationByEvent.get(row.eventId));
    if (row.code?.startsWith('LEADEV-')) return memberships.some((member) => member.organizationId === organizationByEvent.get(row.eventId));
    return true;
  });
}

module.exports = { activeEventAffiliates };
