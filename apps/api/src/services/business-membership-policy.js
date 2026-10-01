const { literal } = require('sequelize');
const { conflict, notFound } = require('../domain/errors');
const { active, activeUser } = require('./lifecycle-service');
const { detachOrgAffiliateForStaffRole, setOrganizationAssignmentsActive } = require('./event-affiliate-transition');
const { revokePendingGuestlistInvitations } = require('./guestlist-invitation-policy');
const { revokeOrganizationVenueAccess } = require('./venue-access-transition');

const unscoped = (model) => model.unscoped ? model.unscoped() : model;
async function lockBusiness(models, organizationId, transaction, version) {
  const organization = await models.Organization.findByPk(organizationId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!organization) throw notFound('Business');
  if (!active(organization) || organization.status !== 'active') throw conflict('Restore this business before changing access', 'BUSINESS_UNAVAILABLE');
  if (version !== undefined && organization.version !== version) throw conflict('This business changed. Refresh before changing access.', 'STALE_VERSION');
  return organization;
}
async function bumpBusiness(models, organization, transaction, changes = {}) {
  const [count, rows] = await models.Organization.update({ ...changes, version: literal('"version" + 1') }, {
    where: { id: organization.id, version: organization.version }, transaction, returning: true,
  });
  if (count !== 1) throw conflict('This business changed. Refresh before changing access.', 'STALE_VERSION');
  Object.assign(organization, { ...changes, version: rows[0].version });
  return rows[0].version;
}
async function bumpAccount(models, user, transaction) {
  const [count, rows] = await models.User.update({ version: literal('"version" + 1') }, { where: { id: user.id, version: user.version }, transaction, returning: true });
  if (count !== 1) throw conflict('This account changed. Refresh before changing access.', 'STALE_VERSION');
  user.version = rows[0].version;
  return user.version;
}
async function activeBusinessOwners(models, organizationId, transaction) {
  const memberships = await unscoped(models.OrganizationOwner).findAll({ where: { organizationId, role: 'owner', lifecycleState: 'active' }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}), order: [['userId', 'ASC']] });
  const owners = [];
  for (const membership of memberships) {
    const user = await models.User.findByPk(membership.userId, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (activeUser(user)) owners.push({ membership, user });
  }
  return owners;
}
async function assertOtherBusinessOwner(models, organizationId, userId, transaction) {
  if (!(await activeBusinessOwners(models, organizationId, transaction)).some(({ user }) => user.id !== userId)) throw conflict('Assign another active owner before changing the last owner', 'LAST_ORGANIZATION_OWNER');
}
async function setBusinessRole({ models, organizationId, user, role, actorUserId, transaction, financeAuthorized = false }) {
  const where = { organizationId, userId: user.id };
  let membership = await unscoped(models.OrganizationOwner).findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
  const staff = ['owner', 'manager', 'employee'].includes(role);
  if (['owner', 'manager'].includes(role)) {
    const values = { role: role === 'owner' ? 'owner' : 'admin', lifecycleState: 'active', financeAuthorized: role === 'manager' && financeAuthorized };
    if (membership) await membership.update(values, { transaction });
    else membership = await models.OrganizationOwner.create({ ...where, ...values }, { transaction });
  } else if (membership) await membership.update({ lifecycleState: 'archived', financeAuthorized: false }, { transaction });
  const employee = await models.OrganizationEmployee.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
  if (employee) await employee.update({ status: role === 'employee' ? 'active' : 'inactive' }, { transaction });
  else if (role === 'employee') await models.OrganizationEmployee.create({ ...where, status: 'active' }, { transaction });
  const affiliate = await models.OrgAffiliate.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
  if (affiliate && staff) await detachOrgAffiliateForStaffRole({ models, orgAffiliate: affiliate, organizationId, userId: user.id, actorUserId, transaction });
  if (affiliate && role !== 'promoter') await affiliate.update({ status: 'inactive' }, { transaction });
  await setOrganizationAssignmentsActive({ models, organizationId, userId: user.id, actorUserId, active: staff || role === 'promoter', staffRole: staff, transaction });
  if (!staff && role !== 'promoter') {
    await revokeOrganizationVenueAccess({ models, organizationId, userId: user.id, actorUserId, transaction });
    await revokePendingGuestlistInvitations({ models, organizationId, userId: user.id, actorUserId, transaction });
  }
  return membership;
}
module.exports = { unscoped, lockBusiness, bumpBusiness, bumpAccount, activeBusinessOwners, assertOtherBusinessOwner, setBusinessRole };
