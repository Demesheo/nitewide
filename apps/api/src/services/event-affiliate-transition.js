const { Op } = require('sequelize');
const { conflict } = require('../domain/errors');
const { accessScope } = require('./event-affiliate-access');

function detachedValues(assignment, orgAffiliate) {
  const values = { orgAffiliateId: null, sourceOrgAffiliateId: orgAffiliate.id, accessScope: 'organization' };
  if (assignment.commissionBps === null) values.commissionBps = orgAffiliate.defaultCommissionBps;
  if (assignment.guestlistAllocation === null) values.guestlistAllocation = orgAffiliate.defaultGuestlistAllocation;
  if (orgAffiliate.startsAt && (!assignment.startsAt || orgAffiliate.startsAt > assignment.startsAt)) values.startsAt = orgAffiliate.startsAt;
  if (orgAffiliate.endsAt && (!assignment.endsAt || orgAffiliate.endsAt < assignment.endsAt)) values.endsAt = orgAffiliate.endsAt;
  return values;
}

async function organizationAssignments(models, organizationId, userId, transaction) {
  const events = await models.Event.findAll({ where: { organizationId }, attributes: ['id'], transaction });
  if (!events.length) return [];
  return models.EventAffiliate.findAll({ where: { eventId: events.map((event) => event.id), userId },
    transaction, lock: transaction.LOCK.UPDATE, order: [['id', 'ASC']] });
}

async function setOrganizationAssignmentsActive({ models, organizationId, userId, actorUserId, active, staffRole = false, transaction }) {
  const assignments = await organizationAssignments(models, organizationId, userId, transaction);
  for (const assignment of assignments) {
    if (accessScope(assignment) !== 'organization') continue;
    const before = assignment.toJSON();
    const values = { status: active ? 'active' : 'inactive', accessScope: 'organization' };
    if (active && staffRole && assignment.orgAffiliateId) {
      const linked = await models.OrgAffiliate.findByPk(assignment.orgAffiliateId, { transaction, lock: transaction.LOCK.UPDATE });
      if (linked && linked.organizationId === organizationId && linked.userId === userId && linked.status === 'inactive') {
        Object.assign(values, detachedValues(assignment, linked));
      }
    }
    if (assignment.status === values.status && assignment.accessScope === values.accessScope && !Object.hasOwn(values, 'orgAffiliateId')) continue;
    await assignment.update(values, { transaction });
    await models.AuditLog.create({ actorUserId, organizationId, entityType: 'EventAffiliate', entityId: assignment.id,
      action: active ? 'event.referrer.organization_scope_restored' : 'event.referrer.organization_scope_revoked',
      before, after: assignment.toJSON() }, { transaction });
  }
}

async function detachOrgAffiliateForStaffRole({ models, orgAffiliate, organizationId, userId, actorUserId, transaction }) {
  if (orgAffiliate.organizationId !== organizationId || orgAffiliate.userId !== userId) throw conflict('Organization affiliate does not match the team member');
  const assignments = await models.EventAffiliate.findAll({
    where: { userId, orgAffiliateId: orgAffiliate.id },
    transaction, lock: transaction.LOCK.UPDATE,
  });
  if (!assignments.length) return;
  const events = await models.Event.findAll({ where: { id: { [Op.in]: assignments.map((assignment) => assignment.eventId) }, organizationId }, attributes: ['id'], transaction });
  const matchingEventIds = new Set(events.map((event) => event.id));
  for (const assignment of assignments.filter((row) => matchingEventIds.has(row.eventId) && accessScope(row) === 'organization')) {
    const before = assignment.toJSON();
    await assignment.update(detachedValues(assignment, orgAffiliate), { transaction });
    await models.AuditLog.create({ actorUserId, organizationId, entityType: 'EventAffiliate', entityId: assignment.id,
      action: 'event.referrer.organization_scope_detached', before, after: assignment.toJSON() }, { transaction });
  }
}

module.exports = { detachOrgAffiliateForStaffRole, setOrganizationAssignmentsActive, detachedValues };
