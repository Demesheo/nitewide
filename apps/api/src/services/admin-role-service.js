const { mutationTransaction } = require('./mutation-transaction');
const { z } = require('zod');
const { Op, literal } = require('sequelize');
const { conflict, notFound } = require('../domain/errors');
const { activeUser } = require('./lifecycle-service');
const { detachOrgAffiliateForStaffRole, setOrganizationAssignmentsActive } = require('./event-affiliate-transition');
const { revokePendingGuestlistInvitations } = require('./guestlist-invitation-policy');
const crypto = require('node:crypto');
const { lockBusiness, bumpBusiness } = require('./business-membership-policy');
const { revokeOrganizationVenueAccess } = require('./venue-access-transition');
const scopedRoleSchema = z.object({ organizationId: z.string().uuid(), role: z.enum(['owner', 'manager', 'employee', 'promoter', 'customer']), reason: z.string().trim().min(3).max(500), version: z.number().int().min(0) }).strict();
const unscoped = (model) => model.unscoped ? model.unscoped() : model;
function createAdminRoleService({ models, permissions }) {
  async function change(actor, userId, body) {
    await permissions.assertInternal(actor); // Preserve access-first errors, then recheck within the write transaction.
    const input = scopedRoleSchema.parse(body);
    return mutationTransaction(models.User.sequelize, async (transaction) => {
      await permissions.assertInternal(actor, transaction);
      const user = await models.User.findByPk(z.string().uuid().parse(userId), { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) throw notFound('User');
      if ((user.version ?? 0) !== input.version) throw conflict('The user changed. Refresh before changing access.', 'STALE_VERSION');
      if (!activeUser(user)) throw conflict('Complete or restore the user before assigning business access', 'USER_UNAVAILABLE');
      const organization = await lockBusiness(models, input.organizationId, transaction);
      const where = { organizationId: input.organizationId, userId };
      const owner = await unscoped(models.OrganizationOwner).findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
      const employee = await models.OrganizationEmployee.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
      const affiliate = await models.OrgAffiliate.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
      if (input.role === 'owner' && (!owner || owner.role !== 'owner' || owner.lifecycleState && owner.lifecycleState !== 'active')) throw conflict('Add an owner through a secure ownership invitation', 'OWNERSHIP_ACCEPTANCE_REQUIRED');
      if (owner?.role === 'owner' && (!owner.lifecycleState || owner.lifecycleState === 'active') && input.role !== 'owner') {
        const others = await models.OrganizationOwner.findAll({ where: { organizationId: input.organizationId, role: 'owner', userId: { [Op.ne]: userId } }, transaction, lock: transaction.LOCK.UPDATE });
        let remaining = false;
        for (const membership of others) if ((!membership.lifecycleState || membership.lifecycleState === 'active') && activeUser(await models.User.findByPk(membership.userId, { transaction, lock: transaction.LOCK.UPDATE }))) remaining = true;
        if (!remaining) throw conflict('Assign another active owner before changing the last owner', 'LAST_ORGANIZATION_OWNER');
        throw conflict('Use the ownership removal or transfer action to change an owner', 'OWNERSHIP_WORKFLOW_REQUIRED');
      }
      const before = { owner: owner?.toJSON?.() || owner || null, employee: employee?.toJSON?.() || employee || null, affiliate: affiliate?.toJSON?.() || affiliate || null };
      if (owner) await owner.update({ lifecycleState: ['owner', 'manager'].includes(input.role) ? 'active' : 'archived', financeAuthorized: input.role === 'manager' && owner.role === 'admin' && (!owner.lifecycleState || owner.lifecycleState === 'active') ? Boolean(owner.financeAuthorized) : false, ...(['owner', 'manager'].includes(input.role) ? { role: input.role === 'owner' ? 'owner' : 'admin' } : {}) }, { transaction });
      else if (['owner', 'manager'].includes(input.role)) await models.OrganizationOwner.create({ ...where, role: input.role === 'owner' ? 'owner' : 'admin', financeAuthorized: false }, { transaction });
      if (employee) await employee.update({ status: input.role === 'employee' ? 'active' : 'inactive' }, { transaction });
      else if (input.role === 'employee') await models.OrganizationEmployee.create({ ...where, status: 'active' }, { transaction });
      const staffRole = ['owner', 'manager', 'employee'].includes(input.role);
      if (staffRole && affiliate) await detachOrgAffiliateForStaffRole({ models, orgAffiliate: affiliate, organizationId: input.organizationId, userId, actorUserId: actor, transaction });
      if (affiliate) await affiliate.update({ status: input.role === 'promoter' ? 'active' : 'inactive' }, { transaction });
      else if (input.role === 'promoter') await models.OrgAffiliate.create({ ...where, code: `NW-${crypto.randomUUID()}`, status: 'active', defaultCommissionBps: 0, defaultGuestlistAllocation: 0 }, { transaction });
      await setOrganizationAssignmentsActive({ models, organizationId: input.organizationId, userId, actorUserId: actor,
        active: staffRole || input.role === 'promoter', staffRole, transaction });
      if (input.role === 'customer' || (owner?.lifecycleState === 'archived' && !['owner', 'manager'].includes(input.role))) {
        if (input.role === 'customer') await revokeOrganizationVenueAccess({ models, organizationId: input.organizationId, userId, actorUserId: actor, transaction });
        await revokePendingGuestlistInvitations({ models, organizationId: input.organizationId, userId,
          directOnly: input.role !== 'customer', actorUserId: actor, transaction });
      }
      // This edit changes membership rows, not a User field. An instance update of
      // Sequelize's version attribute is a no-op, so use a database compare-and-swap.
      const [changed, updatedUsers] = await models.User.update(
        { version: literal('"version" + 1') },
        { where: { id: userId, version: input.version }, returning: true, transaction },
      );
      if (changed !== 1) throw conflict('The user changed. Refresh before changing access.', 'STALE_VERSION');
      await bumpBusiness(models, organization, transaction);
      await models.AuditLog.create({ actorUserId: actor, organizationId: input.organizationId, entityType: 'User', entityId: userId, action: 'admin.user.scoped_role_changed', before, after: { role: input.role, adminReason: input.reason } }, { transaction });
      return { userId, organizationId: input.organizationId, role: input.role, version: updatedUsers[0].version };
    }, { accessChange: true });
  }
  return { change };
}
module.exports = { createAdminRoleService, scopedRoleSchema };
