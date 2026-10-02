const crypto = require('node:crypto');
const { Op } = require('sequelize');
const { forbidden, notFound, conflict } = require('../domain/errors');
const { assertEventEditable } = require('../domain/event-policy');
const { queueTeamInvitation, queuePromoterInvitation, queueAccessAccepted, queueAccessChanged } = require('./business-email-events');
const { activeUser, assertActiveEvent, assertActiveOrganization } = require('./lifecycle-service');
const { detachOrgAffiliateForStaffRole, setOrganizationAssignmentsActive } = require('./event-affiliate-transition');
const { revokePendingGuestlistInvitations } = require('./guestlist-invitation-policy');
const { mutationTransaction } = require('./mutation-transaction');
const { assertCommissionPricing } = require('../domain/editor-pricing-policy');
const { revokeOrganizationVenueAccess } = require('./venue-access-transition');
const { commissionTerms, assertCommissionEligible } = require('../domain/commission-eligibility');

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
function rosterPeople(leaders, employees, promoters) {
  const people = new Map();
  const add = (entry, role) => {
    if (!entry.user || people.has(entry.userId)) return;
    people.set(entry.userId, { id: entry.userId, name: entry.user.displayName || 'Unknown', email: entry.user.email || '', role, status: entry.status || 'active', joined: entry.createdAt, financeAuthorized: role === 'Owner' || (role === 'Manager' && Boolean(entry.financeAuthorized)), paymentDisconnectAuthorized:role === 'Owner' || (role === 'Manager' && Boolean(entry.paymentDisconnectAuthorized)), ...commissionTerms(entry.defaultCommissionBps ?? 0) });
  };
  for (const entry of leaders.filter((row) => row.role === 'owner')) add(entry, 'Owner');
  for (const entry of leaders.filter((row) => row.role !== 'owner')) add(entry, 'Manager');
  for (const entry of employees.filter((row) => row.status === 'active')) add(entry, 'Employee');
  for (const entry of promoters.filter((row) => row.status === 'active')) add(entry, 'Promoter');
  return [...people.values()];
}
function createTeamService({ models, permissions, email: emailService = null, businessAppUrl = 'http://localhost:5174/app' }) {
  async function assertManager(userId, organizationId, transaction) {
    await permissions.assertManageOrganization(userId, organizationId, transaction);
    const organization = await models.Organization.findByPk(organizationId, { transaction });
    if (!organization) throw notFound('Organization');
    return organization;
  }
  async function roster(userId, organizationId) {
    const organization = await assertManager(userId, organizationId);
    const [leaders, employees, affiliates, invitations] = await Promise.all([
      models.OrganizationOwner.findAll({ where: { organizationId }, include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] }] }),
      models.OrganizationEmployee.findAll({ where: { organizationId }, include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] }] }),
      models.OrgAffiliate.findAll({ where: { organizationId }, include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] }] }),
      models.TeamInvitation.findAll({ where: { organizationId, acceptedAt: null, expiresAt: { [Op.gt]: new Date() } }, attributes: ['id', 'email', 'phone', 'role', 'expiresAt', 'createdAt'], order: [['createdAt', 'DESC']] }),
    ]);
    const promoters = affiliates.filter((affiliate) => affiliate.status === 'active' && !affiliate.code.endsWith('-STAFF'));
    return { leaders, employees, affiliates: promoters.map((row) => ({ ...(row.toJSON ? row.toJSON() : row), ...commissionTerms(row.defaultCommissionBps ?? 0) })), people: rosterPeople(leaders, employees, promoters), invitations,
      organizationVersion: organization.version, canGrantFinance: leaders.some((row) => row.userId === userId && row.role === 'owner' && row.lifecycleState !== 'archived' && row.lifecycleState !== 'suspended') };
  }
  async function invite(userId, organizationId, input) {
    return mutationTransaction(models.TeamInvitation.sequelize, async (transaction) => {
      const organization = await assertManager(userId, organizationId, transaction);
      const email = input.email.trim().toLowerCase();
      const token = crypto.randomBytes(32).toString('base64url');
      const invitation = await models.TeamInvitation.create({ organizationId, invitedByUserId: userId, email, phone: input.phone, role: input.role, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000) }, { transaction });
      await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'TeamInvitation', entityId: invitation.id, action: 'team.invited', after: { email, role: input.role } }, { transaction });
      const queued = await queueTeamInvitation({ email: emailService, invitation, organization, token, businessAppUrl, transaction });
      // Future Twilio invitation delivery belongs after the invitation is saved.
      // Send only when the inviter explicitly chooses SMS, and log delivery status;
      // this inviter supplied number is never copied to the invitee's User record.
      return { id: invitation.id, organizationName: organization.name, email, phone: invitation.phone, role: input.role, token, expiresAt: invitation.expiresAt, delivery: queued ? 'queued' : 'manual' };
    });
  }
  async function changeRole(actorUserId, organizationId, memberUserId, nextRole) {
    if (actorUserId === memberUserId) throw conflict('You cannot change your own organization role');
    const validRoles = ['manager', 'employee', 'affiliate'];
    if (!validRoles.includes(nextRole)) throw conflict('Unsupported team role');
    return mutationTransaction(models.Organization.sequelize, async (transaction) => {
      const organization = await assertManager(actorUserId, organizationId, transaction);
      const existingOwner = await models.OrganizationOwner.unscoped().findOne({ where: { organizationId, userId: memberUserId }, transaction, lock: transaction.LOCK.UPDATE });
      if (existingOwner?.role === 'owner' && existingOwner.lifecycleState === 'active') throw conflict('Organization owners cannot be reassigned from the team page');
      const [employee, affiliate] = await Promise.all([
        models.OrganizationEmployee.findOne({ where: { organizationId, userId: memberUserId }, transaction, lock: transaction.LOCK.UPDATE }),
        models.OrgAffiliate.findOne({ where: { organizationId, userId: memberUserId }, transaction, lock: transaction.LOCK.UPDATE }),
      ]);
      if (!existingOwner && !employee && !affiliate) throw notFound('Organization team member');
      const before = existingOwner?.lifecycleState === 'active' ? 'manager' : employee?.status === 'active' ? 'employee' : affiliate?.status === 'active' ? 'affiliate' : 'removed';
      if (existingOwner && nextRole !== 'manager') await existingOwner.update({ lifecycleState: 'archived', financeAuthorized: false }, { transaction });
      if (employee?.status === 'active') await employee.update({ status: 'inactive' }, { transaction });
      if (nextRole === 'manager') {
        if (existingOwner) await existingOwner.update({ role: 'admin', lifecycleState: 'active', financeAuthorized: existingOwner.lifecycleState === 'active' && existingOwner.role === 'admin' && Boolean(existingOwner.financeAuthorized) }, { transaction });
        else await models.OrganizationOwner.create({ organizationId, userId: memberUserId, role: 'admin', financeAuthorized: false }, { transaction });
      } else if (nextRole === 'employee') {
        if (employee) await employee.update({ status: 'active' }, { transaction });
        else await models.OrganizationEmployee.create({ organizationId, userId: memberUserId, status: 'active' }, { transaction });
      } else if (affiliate) {
        await affiliate.update({ status: 'active' }, { transaction });
      } else {
        await models.OrgAffiliate.create({ organizationId, userId: memberUserId, code: `org-${crypto.randomUUID()}`, defaultCommissionBps: 0, defaultGuestlistAllocation: 0, status: 'active' }, { transaction });
      }
      if (affiliate && nextRole !== 'affiliate') {
        await detachOrgAffiliateForStaffRole({ models, orgAffiliate: affiliate, organizationId, userId: memberUserId, actorUserId, transaction });
        if (affiliate.status === 'active') await affiliate.update({ status: 'inactive' }, { transaction });
      }
      await setOrganizationAssignmentsActive({ models, organizationId, userId: memberUserId, actorUserId, active: true,
        staffRole: nextRole !== 'affiliate', transaction });
      if (before === 'manager' && nextRole !== 'manager') await revokePendingGuestlistInvitations({ models, organizationId, userId: memberUserId, directOnly: true, actorUserId, transaction });
      const audit = await models.AuditLog.create({ actorUserId, organizationId, entityType: 'OrganizationTeamMember', entityId: memberUserId, action: 'team.member.role_changed', before: { role: before }, after: { role: nextRole } }, { transaction });
      await queueAccessChanged({ email: emailService, models, userId: memberUserId, organization,
        oldRole: before, newRole: nextRole, actionId: audit.id, businessAppUrl, transaction });
      return { userId: memberUserId, role: nextRole };
    }, { accessChange: true });
  }
  async function removeMember(actorUserId, organizationId, memberUserId) {
    if (actorUserId === memberUserId) throw conflict('You cannot remove your own organization role');
    return mutationTransaction(models.Organization.sequelize, async (transaction) => {
      const organization = await assertManager(actorUserId, organizationId, transaction);
      const owner = await models.OrganizationOwner.unscoped().findOne({ where: { organizationId, userId: memberUserId }, transaction, lock: transaction.LOCK.UPDATE });
      if (owner?.role === 'owner' && owner.lifecycleState === 'active') throw conflict('Organization owners cannot be removed from the team page');
      const [employee, affiliate] = await Promise.all([
        models.OrganizationEmployee.findOne({ where: { organizationId, userId: memberUserId }, transaction, lock: transaction.LOCK.UPDATE }),
        models.OrgAffiliate.findOne({ where: { organizationId, userId: memberUserId }, transaction, lock: transaction.LOCK.UPDATE }),
      ]);
      if (!owner && !employee && !affiliate) throw notFound('Organization team member');
      const before = {
        role: owner?.lifecycleState === 'active' ? 'manager' : employee?.status === 'active' ? 'employee' : affiliate?.status === 'active' ? 'affiliate' : 'inactive',
        employeeStatus: employee?.status || null,
        promoterStatus: affiliate?.status || null,
      };
      if (owner && owner.lifecycleState === 'active') await owner.update({ lifecycleState: 'archived', financeAuthorized: false }, { transaction });
      if (employee?.status === 'active') await employee.update({ status: 'inactive' }, { transaction });
      if (affiliate?.status === 'active') await affiliate.update({ status: 'inactive' }, { transaction });
      await setOrganizationAssignmentsActive({ models, organizationId, userId: memberUserId, actorUserId, active: false, transaction });
      await revokeOrganizationVenueAccess({ models, organizationId, userId: memberUserId, actorUserId, transaction });
      await revokePendingGuestlistInvitations({ models, organizationId, userId: memberUserId, actorUserId, transaction });
      const audit = await models.AuditLog.create({ actorUserId, organizationId, entityType: 'OrganizationTeamMember', entityId: memberUserId, action: 'team.member.removed', before, after: { status: 'inactive' } }, { transaction });
      await queueAccessChanged({ email: emailService, models, userId: memberUserId, organization,
        oldRole: before.role, newRole: 'removed', actionId: audit.id, businessAppUrl, transaction });
      return { userId: memberUserId, removed: true };
    }, { accessChange: true });
  }
  async function invitation(token) {
    const row = await models.TeamInvitation.findOne({ where: { tokenHash: hash(token), acceptedAt: null, expiresAt: { [Op.gt]: new Date() } }, include: [{ model: models.Organization, as: 'organization', attributes: ['id', 'name'] }, { model: models.Event, as: 'event', attributes: ['id','title','endsAt','status'] }] });
    if (!row) throw notFound('Active invitation');
    if (row.eventId) assertEventEditable(row.event);
    const terms = commissionTerms(row.commissionBps ?? 0);
    return { email: row.email, phone: row.phone, role: row.role, organizationName: row.organization?.name, eventId:row.eventId, eventTitle:row.event?.title, commissionBps:terms.effectiveCommissionBps, ...terms, expiresAt: row.expiresAt };
  }
  async function eventInvitations(userId, eventId) {
    await permissions.assertManageEvent(userId,eventId);
    const invitations = await models.TeamInvitation.findAll({where:{eventId,acceptedAt:null,expiresAt:{[Op.gt]:new Date()}},attributes:['id','email','phone','expiresAt','commissionBps'],order:[['createdAt','DESC']]});
    return invitations.map((row) => { const terms = commissionTerms(row.commissionBps ?? 0); return { ...(row.toJSON ? row.toJSON() : row), ...terms, commissionBps: terms.effectiveCommissionBps }; });
  }
  async function inviteEvent(userId, eventId, input) {
    return mutationTransaction(models.TeamInvitation.sequelize, async (transaction) => {
      const event = await models.Event.findByPk(eventId,{transaction,lock:transaction.LOCK.UPDATE});
      await permissions.assertManageEvent(userId,eventId,transaction);
      assertEventEditable(event);
      assertCommissionEligible(input.commissionBps ?? 0);
      if (models.Offering) await assertCommissionPricing({ models, eventId, commissionBps: input.commissionBps ?? 0, transaction });
      const email = input.email.trim().toLowerCase();
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Math.min(Date.now()+7*86400000,new Date(event.endsAt).getTime()));
      // Renew pending invitations so repeated sends leave only one valid link.
      const pending = await models.TeamInvitation.findOne({where:{eventId,email,acceptedAt:null},transaction,lock:transaction.LOCK.UPDATE});
      const values = {tokenHash:hash(token),expiresAt,invitedByUserId:userId,phone:input.phone,commissionBps:input.commissionBps ?? 0};
      const row = pending ? await pending.update(values,{transaction}) : await models.TeamInvitation.create({...values,eventId,organizationId:null,email,role:'affiliate'},{transaction});
      await models.AuditLog.create({actorUserId:userId,organizationId:event.organizationId,entityType:'TeamInvitation',entityId:row.id,action:'event.promoter.invited',after:{eventId,email,commissionBps:values.commissionBps}},{transaction});
      const queued = await queuePromoterInvitation({ email: emailService, invitation: row, event, token, businessAppUrl, transaction });
      // Future Twilio send can use row.phone only after an explicit SMS send action.
      return {id:row.id,eventId,eventTitle:event.title,email,phone:row.phone,role:'affiliate',commissionBps:values.commissionBps,token,expiresAt,delivery:queued ? 'queued' : 'manual'};
    });
  }
  async function revokeEvent(userId,eventId,invitationId) {
    return mutationTransaction(models.TeamInvitation.sequelize, async (transaction) => {
    await permissions.assertManageEvent(userId,eventId,transaction);
    const row = await models.TeamInvitation.findOne({where:{id:invitationId,eventId,acceptedAt:null},transaction,lock:transaction.LOCK.UPDATE});
    if (!row) throw notFound('Pending invitation');
    await row.update({expiresAt:new Date(0)},{transaction});
    return {revoked:true};
    }, { accessChange: true });
  }
  async function revoke(userId, organizationId, invitationId) {
    return mutationTransaction(models.TeamInvitation.sequelize, async (transaction) => {
    await assertManager(userId, organizationId, transaction);
    const row = await models.TeamInvitation.findOne({ where: { id: invitationId, organizationId, acceptedAt: null }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw notFound('Pending invitation');
    await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'TeamInvitation', entityId: row.id, action: 'team.invitation.revoked', before: { email: row.email, role: row.role } }, { transaction });
    await row.destroy({ transaction });
    return { revoked: true };
    }, { accessChange: true });
  }
  async function resend(userId, organizationId, invitationId) {
    return mutationTransaction(models.TeamInvitation.sequelize, async (transaction) => {
    const organization = await assertManager(userId, organizationId, transaction);
    const row = await models.TeamInvitation.findOne({ where: { id: invitationId, organizationId, acceptedAt: null }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw notFound('Pending invitation');
    const token = crypto.randomBytes(32).toString('base64url');
    await row.update({ tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000) }, { transaction });
    await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'TeamInvitation', entityId: row.id, action: 'team.invitation.renewed', after: { email: row.email, role: row.role } }, { transaction });
    const queued = await queueTeamInvitation({ email: emailService, invitation: row, organization, token, businessAppUrl, transaction });
    return { email: row.email, phone: row.phone, role: row.role, organizationName: organization.name, token, expiresAt: row.expiresAt, delivery: queued ? 'queued' : 'manual' };
    });
  }
  async function accept(userId, token) {
    return mutationTransaction(models.TeamInvitation.sequelize, async (transaction) => {
      // Use the same event → invitation lock order as issuing/renewing a link.
      const scope = await models.TeamInvitation.findOne({where:{tokenHash:hash(token)},transaction});
      if (scope?.eventId) await models.Event.findByPk(scope.eventId,{transaction,lock:transaction.LOCK.UPDATE});
      const row = await models.TeamInvitation.findOne({ where: { tokenHash: hash(token) }, transaction, lock: transaction.LOCK.UPDATE });
      if (!row || row.acceptedAt || row.expiresAt <= new Date()) throw notFound('Active invitation');
      const user = await models.User.findByPk(userId, { transaction });
      if (!activeUser(user) || user.email.toLowerCase() !== row.email) throw forbidden('Sign in with the active invited email address');
      const inviter = await models.User.findByPk(row.invitedByUserId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!activeUser(inviter)) throw forbidden('The inviter no longer has access');
      if (row.eventId) {
        if (!user.isActive || row.role !== 'affiliate') throw forbidden();
        const event = await models.Event.findByPk(row.eventId,{transaction,lock:transaction.LOCK.UPDATE});
        await assertActiveEvent(models, event, transaction);
        assertEventEditable(event);
        await permissions.assertManageEvent(row.invitedByUserId,row.eventId,transaction);
        // Accept legacy access without silently rewriting its configured terms.
        // Only the effective, individually eligible rate applies to future sales.
        if (models.Offering) await assertCommissionPricing({ models, eventId: row.eventId, commissionBps: commissionTerms(row.commissionBps ?? 0).effectiveCommissionBps, transaction });
        const [assignment,created] = await models.EventAffiliate.findOrCreate({where:{eventId:row.eventId,userId},defaults:{code:`NW-${crypto.randomUUID()}`,commissionBps:row.commissionBps,guestlistAllocation:0,status:'active',accessScope:'event'},transaction});
        const before = created ? null : assignment.toJSON();
        if (!created) {
          const linked = assignment.orgAffiliateId ? await models.OrgAffiliate.findByPk(assignment.orgAffiliateId, { transaction }) : null;
          const values = { status: 'active', commissionBps: row.commissionBps, accessScope: 'event', orgAffiliateId: null, sourceOrgAffiliateId: null, venueAccessId: null };
          if (linked) {
            if (assignment.guestlistAllocation === null) values.guestlistAllocation = linked.defaultGuestlistAllocation;
            if (linked.startsAt && (!assignment.startsAt || linked.startsAt > assignment.startsAt)) values.startsAt = linked.startsAt;
            if (linked.endsAt && (!assignment.endsAt || linked.endsAt < assignment.endsAt)) values.endsAt = linked.endsAt;
          }
          await assignment.update(values, { transaction });
        }
        await models.AuditLog.create({actorUserId:userId,organizationId:event.organizationId,entityType:'EventAffiliate',entityId:assignment.id,action:'event.promoter.invitation_terms_accepted',before,after:assignment.toJSON()},{transaction});
        await row.update({acceptedAt:new Date(),acceptedByUserId:userId},{transaction});
        await models.AuditLog.create({actorUserId:userId,organizationId:event.organizationId,entityType:'TeamInvitation',entityId:row.id,action:'event.promoter.accepted',after:{eventId:row.eventId,userId}},{transaction});
        await queueAccessAccepted({ email: emailService, models, invitation: row, invitee: user, context: event.title, transaction });
        return {eventId:row.eventId,role:'affiliate'};
      } else if (['employee', 'manager', 'affiliate'].includes(row.role)) {
        await assertActiveOrganization(models, row.organizationId, transaction);
        await permissions.assertManageOrganization(row.invitedByUserId, row.organizationId, transaction);
        const where = { organizationId: row.organizationId, userId };
        const [owner, employee, affiliate] = await Promise.all([
          models.OrganizationOwner.unscoped().findOne({ where, transaction, lock: transaction.LOCK.UPDATE }),
          models.OrganizationEmployee.findOne({ where, transaction, lock: transaction.LOCK.UPDATE }),
          models.OrgAffiliate.findOne({ where, transaction, lock: transaction.LOCK.UPDATE }),
        ]);
        if (owner?.role === 'owner' && owner.lifecycleState === 'active' && row.role !== 'manager') throw conflict('Organization owners cannot be reassigned through an invitation');
        const staffRole = row.role !== 'affiliate';
        if (staffRole && affiliate) await detachOrgAffiliateForStaffRole({ models, orgAffiliate: affiliate,
          organizationId: row.organizationId, userId, actorUserId: row.invitedByUserId, transaction });
        if (owner) await owner.update({ lifecycleState: row.role === 'manager' ? 'active' : 'archived', financeAuthorized: row.role === 'manager' && owner.lifecycleState === 'active' && owner.role === 'admin' && Boolean(owner.financeAuthorized),
          ...(row.role === 'manager' && !(owner.role === 'owner' && owner.lifecycleState === 'active') ? { role: 'admin' } : {}) }, { transaction });
        else if (row.role === 'manager') await models.OrganizationOwner.create({ ...where, role: 'admin', financeAuthorized: false }, { transaction });
        if (employee) await employee.update({ status: row.role === 'employee' ? 'active' : 'inactive' }, { transaction });
        else if (row.role === 'employee') await models.OrganizationEmployee.create({ ...where, status: 'active' }, { transaction });
        if (affiliate) await affiliate.update({ status: row.role === 'affiliate' ? 'active' : 'inactive' }, { transaction });
        else if (row.role === 'affiliate') await models.OrgAffiliate.create({ ...where, code: `org-${crypto.randomUUID()}`, defaultCommissionBps: 0, defaultGuestlistAllocation: 0 }, { transaction });
        await setOrganizationAssignmentsActive({ models, organizationId: row.organizationId, userId,
          actorUserId: row.invitedByUserId, active: true, staffRole, transaction });
      } else throw conflict('Invalid invitation role');
      await row.update({ acceptedAt: new Date(), acceptedByUserId: userId }, { transaction });
      await models.AuditLog.create({ actorUserId: userId, organizationId: row.organizationId, entityType: 'TeamInvitation', entityId: row.id, action: 'team.invitation.accepted', after: { role: row.role, userId } }, { transaction });
      if (emailService?.enabled) {
        const organization = await models.Organization.findByPk(row.organizationId, { transaction });
        await queueAccessAccepted({ email: emailService, models, invitation: row, invitee: user, context: organization?.name || 'your organization', transaction });
      }
      return { organizationId: row.organizationId, role: row.role };
    }, { accessChange: true });
  }
  return { roster, invite, changeRole, removeMember, invitation, accept, revoke, resend, inviteEvent, eventInvitations, revokeEvent };
}
module.exports = { createTeamService, rosterPeople };
