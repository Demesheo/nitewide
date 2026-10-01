const { z } = require('zod');
const { Op } = require('sequelize');
const { mutationTransaction } = require('./mutation-transaction');
const { conflict, forbidden, notFound } = require('../domain/errors');
const { active, activeUser } = require('./lifecycle-service');
const { unscoped, lockBusiness, bumpBusiness, bumpAccount, activeBusinessOwners, assertOtherBusinessOwner, setBusinessRole } = require('./business-membership-policy');
const { recipientSchema } = require('./admin-onboarding-service');

const reason = z.string().trim().min(3).max(500);
const version = z.number().int().min(0);
const outgoingRole = z.enum(['manager', 'employee', 'remove']);
const ownershipInvitationSchema = z.object({ recipient: recipientSchema, outgoingOwnerUserId: z.string().uuid().optional(), outgoingRole: outgoingRole.optional(), reason, version }).strict().superRefine((value, context) => {
  if (Boolean(value.outgoingOwnerUserId) !== Boolean(value.outgoingRole)) context.addIssue({ code: 'custom', message: 'A transfer requires the outgoing owner and the role they retain' });
  if (value.recipient.role !== 'owner' || value.recipient.financeAuthorized) context.addIssue({ code: 'custom', message: 'Ownership invitations grant the owner role; finance is separate for retained managers' });
});
const ownershipRemoveSchema = z.object({ outgoingRole, reason, version }).strict();
const ownershipRecoverySchema = z.object({ userId: z.string().uuid(), confirmed: z.literal(true), reason, version }).strict();
const financePermissionSchema = z.object({ financeAuthorized: z.boolean(), reason, version }).strict();

function createAdminBusinessAccessService({ models, permissions, onboardingService, now = () => new Date() }) {
  const write = async (work) => {
    try { return await mutationTransaction(models.User.sequelize, work, { accessChange: true }); }
    catch (error) {
      if (['40001', '40P01'].includes(error.original?.code || error.parent?.code) || error.name === 'SequelizeOptimisticLockError') throw conflict('This access changed concurrently. Refresh and try again.', 'CONCURRENT_CHANGE');
      if (error.name === 'SequelizeUniqueConstraintError') throw conflict('This account or membership already exists. Refresh and try again.', 'DUPLICATE_RECORD');
      throw error;
    }
  };
  async function audit(actor, organizationId, action, before, after, tx) { await models.AuditLog.create({ actorUserId: actor, organizationId, entityType: 'Organization', entityId: organizationId, action, before, after }, { transaction: tx }); }
  async function detail(actor, id) {
    await permissions.assertInternal(actor);
    const organization = await models.Organization.findByPk(z.string().uuid().parse(id));
    if (!organization) throw notFound('Business');
    const memberships = await unscoped(models.OrganizationOwner).findAll({ where: { organizationId: id, lifecycleState: 'active' }, order: [['createdAt', 'ASC']] });
    const owners = []; const managers = [];
    for (const membership of memberships) {
      const user = await models.User.findByPk(membership.userId);
      if (!user) continue;
      const row = { id: membership.id, userId: user.id, displayName: user.displayName, email: user.email, isActive: activeUser(user), role: membership.role === 'owner' ? 'owner' : 'manager', financeAuthorized: membership.role === 'owner' || Boolean(membership.financeAuthorized), version: membership.version };
      (membership.role === 'owner' ? owners : managers).push(row);
    }
    // Cap outstanding invites so a detail page never becomes an unbounded log.
    const pending = await models.OnboardingInvitation.findAll({ where: { acceptedAt: null, revokedAt: null, expiresAt: { [Op.gt]: now() }, grants: { organizationId: id } }, order: [['createdAt', 'DESC']], limit: 100 });
    const invitations = [];
    for (const row of pending) { const user = await models.User.findByPk(row.userId); invitations.push({ ...onboardingService.safeInvitation(row), displayName: user?.displayName || row.email }); }
    return { id: organization.id, name: organization.name, version: organization.version, onboardingEstablished: organization.onboardingEstablished, owners, managers, invitations };
  }
  async function invite(actor, id, body) {
    await permissions.assertInternal(actor); const input = ownershipInvitationSchema.parse(body); z.string().uuid().parse(id);
    return write(async (tx) => {
      await permissions.assertInternal(actor, tx);
      const organization = await lockBusiness(models, id, tx, input.version);
      const grants = { kind: organization.businessType, organizationId: id, role: 'owner', financeAuthorized: false, ownershipIntent: input.outgoingOwnerUserId ? 'transfer' : 'add' };
      if (input.outgoingOwnerUserId) {
        const membership = await unscoped(models.OrganizationOwner).findOne({ where: { organizationId: id, userId: input.outgoingOwnerUserId }, transaction: tx, lock: tx.LOCK.UPDATE });
        const outgoing = await models.User.findByPk(input.outgoingOwnerUserId, { transaction: tx, lock: tx.LOCK.UPDATE });
        if (!active(membership) || membership.role !== 'owner' || !activeUser(outgoing)) throw conflict('Select an active outgoing business owner', 'OUTGOING_OWNER_UNAVAILABLE');
        if (outgoing.email === input.recipient.email) throw conflict('The incoming and outgoing owners must be different accounts', 'OWNERSHIP_SAME_ACCOUNT');
        Object.assign(grants, { outgoingOwnerUserId: outgoing.id, outgoingRole: input.outgoingRole, outgoingMembershipVersion: membership.version, businessVersion: organization.version });
      }
      const invitation = await onboardingService.createAccessInvitation(actor, input.recipient, grants, input.reason, tx);
      await audit(actor, id, `admin.ownership.${grants.ownershipIntent}_invited`, null, { incomingUserId: invitation.userId, outgoingOwnerUserId: input.outgoingOwnerUserId || null, outgoingRole: input.outgoingRole || null, invitationId: invitation.id, adminReason: input.reason }, tx);
      return invitation;
    });
  }
  async function remove(actor, id, userId, body) {
    await permissions.assertInternal(actor); const input = ownershipRemoveSchema.parse(body); z.string().uuid().parse(id); z.string().uuid().parse(userId);
    return write(async (tx) => {
      await permissions.assertInternal(actor, tx); const organization = await lockBusiness(models, id, tx, input.version);
      const user = await models.User.findByPk(userId, { transaction: tx, lock: tx.LOCK.UPDATE });
      const membership = await unscoped(models.OrganizationOwner).findOne({ where: { organizationId: id, userId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!user || !active(membership) || membership.role !== 'owner') throw notFound('Business owner');
      await assertOtherBusinessOwner(models, id, userId, tx);
      const before = membership.toJSON();
      await setBusinessRole({ models, organizationId: id, user, role: input.outgoingRole, actorUserId: actor, transaction: tx });
      await bumpAccount(models, user, tx); const nextVersion = await bumpBusiness(models, organization, tx);
      await audit(actor, id, 'admin.ownership.removed', before, { userId, outgoingRole: input.outgoingRole, financeAuthorized: false, adminReason: input.reason }, tx);
      return { organizationId: id, userId, role: input.outgoingRole, financeAuthorized: false, version: nextVersion };
    });
  }
  async function recover(actor, id, body) {
    await permissions.assertInternal(actor); const input = ownershipRecoverySchema.parse(body); z.string().uuid().parse(id);
    return write(async (tx) => {
      await permissions.assertInternal(actor, tx); const organization = await lockBusiness(models, id, tx, input.version);
      if ((await activeBusinessOwners(models, id, tx)).length) throw conflict('Recovery applies only when the business has no active owner', 'OWNERSHIP_RECOVERY_NOT_REQUIRED');
      const user = await models.User.findByPk(input.userId, { transaction: tx, lock: tx.LOCK.UPDATE });
      if (!activeUser(user) || !user.emailVerifiedAt) throw conflict('Recovery requires an active, verified existing account', 'RECOVERY_ACCOUNT_UNAVAILABLE');
      await setBusinessRole({ models, organizationId: id, user, role: 'owner', actorUserId: actor, transaction: tx });
      await bumpAccount(models, user, tx); const nextVersion = await bumpBusiness(models, organization, tx, { onboardingEstablished: true });
      await audit(actor, id, 'admin.ownership.recovery_override', null, { userId: user.id, confirmed: true, adminReason: input.reason }, tx);
      return { organizationId: id, userId: user.id, role: 'owner', version: nextVersion };
    });
  }
  async function finance(actor, id, userId, body, internal = true) {
    if (internal) await permissions.assertInternal(actor); else await permissions.assertOwnOrganization(actor, id);
    const input = financePermissionSchema.parse(body); z.string().uuid().parse(id); z.string().uuid().parse(userId);
    return write(async (tx) => {
      if (internal) await permissions.assertInternal(actor, tx); else {
        // The business endpoint is strictly owner-scoped; internal staff must use
        // their separately audited administrative endpoint.
        const owner = await models.OrganizationOwner.findOne({ where: { organizationId: id, userId: actor, role: 'owner', lifecycleState: 'active' }, transaction: tx, lock: tx.LOCK.UPDATE });
        const actorUser = await models.User.findByPk(actor, { transaction: tx, lock: tx.LOCK.UPDATE });
        if (!owner || !activeUser(actorUser)) throw forbidden('Business owner access required to grant manager finance permission');
      }
      const organization = await lockBusiness(models, id, tx, input.version);
      const user = await models.User.findByPk(userId, { transaction: tx, lock: tx.LOCK.UPDATE });
      const membership = await models.OrganizationOwner.findOne({ where: { organizationId: id, userId, role: 'admin', lifecycleState: 'active' }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!membership || !activeUser(user)) throw conflict('Select an active manager in this business', 'FINANCE_MANAGER_REQUIRED');
      const before = { userId, financeAuthorized: Boolean(membership.financeAuthorized) };
      await membership.update({ financeAuthorized: input.financeAuthorized }, { transaction: tx });
      await bumpAccount(models, user, tx); const nextVersion = await bumpBusiness(models, organization, tx);
      await audit(actor, id, internal ? 'admin.finance.permission_changed' : 'business.finance.permission_changed', before, { userId, financeAuthorized: input.financeAuthorized, adminReason: input.reason }, tx);
      return { organizationId: id, userId, financeAuthorized: input.financeAuthorized, version: nextVersion };
    });
  }
  return { detail, invite, remove, recover, finance };
}
module.exports = { createAdminBusinessAccessService, ownershipInvitationSchema, ownershipRemoveSchema, ownershipRecoverySchema, financePermissionSchema };
