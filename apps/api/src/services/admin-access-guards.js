const { Op } = require('sequelize');
const { conflict } = require('../domain/errors');

async function assertUserAccessChange({ models, actorUserId, user, changes, transaction }) {
  const losesAdmin = changes.isInternalAdmin === false || changes.isActive === false || (changes.lifecycleState && changes.lifecycleState !== 'active');
  if (user.id === actorUserId && losesAdmin) throw conflict('You cannot disable your own administrator access', 'SELF_ADMIN_LOCKOUT');
  if (user.isInternalAdmin && user.isActive && losesAdmin && await models.User.count({ where: { isInternalAdmin: true, isActive: true, ...(models.User.rawAttributes?.lifecycleState ? { lifecycleState: 'active', onboardingPending: false } : {}) }, transaction }) <= 1) throw conflict('At least one active administrator is required', 'LAST_ADMIN');
  if (changes.isActive !== false || !user.isActive || !models.OrganizationOwner || !models.Organization) return;
  const memberships = await models.OrganizationOwner.findAll({ where: { userId: user.id, role: 'owner' }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  for (const membership of memberships) {
    const organization = await models.Organization.findByPk(membership.organizationId, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!organization || organization.status !== 'active') continue;
    const owners = await models.OrganizationOwner.findAll({ where: { organizationId: membership.organizationId, role: 'owner', userId: { [Op.ne]: user.id } }, attributes: ['userId'], transaction });
    const activeOwners = owners.length ? await models.User.count({ where: { id: { [Op.in]: owners.map((owner) => owner.userId) }, isActive: true, ...(models.User.rawAttributes?.lifecycleState ? { lifecycleState: 'active', onboardingPending: false } : {}) }, transaction }) : 0;
    if (!activeOwners) throw conflict(`Assign another active owner before deactivating the only active owner of ${organization.name}`, 'LAST_ORGANIZATION_OWNER');
  }
}

module.exports = { assertUserAccessChange };
