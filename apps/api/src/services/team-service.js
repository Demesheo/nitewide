const crypto = require('node:crypto');
const { Op } = require('sequelize');
const { forbidden, notFound, conflict } = require('../domain/errors');
const { assertEventEditable } = require('../domain/event-policy');

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
function rosterPeople(leaders, employees, promoters) {
  const people = new Map();
  const add = (entry, role) => {
    if (!entry.user || people.has(entry.userId)) return;
    people.set(entry.userId, { id: entry.userId, name: entry.user.displayName || 'Unknown', email: entry.user.email || '', role, status: entry.status || 'active', joined: entry.createdAt });
  };
  for (const entry of leaders.filter((row) => row.role === 'owner')) add(entry, 'Owner');
  for (const entry of leaders.filter((row) => row.role !== 'owner')) add(entry, 'Manager');
  for (const entry of employees.filter((row) => row.status === 'active')) add(entry, 'Employee');
  for (const entry of promoters.filter((row) => row.status === 'active')) add(entry, 'Promoter');
  return [...people.values()];
}
function createTeamService({ models, permissions }) {
  async function assertManager(userId, organizationId) {
    await permissions.assertManageOrganization(userId, organizationId);
    const organization = await models.Organization.findByPk(organizationId);
    if (!organization) throw notFound('Organization');
    return organization;
  }
  async function roster(userId, organizationId) {
    await assertManager(userId, organizationId);
    const [leaders, employees, affiliates, invitations] = await Promise.all([
      models.OrganizationOwner.findAll({ where: { organizationId }, include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] }] }),
      models.OrganizationEmployee.findAll({ where: { organizationId }, include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] }] }),
      models.OrgAffiliate.findAll({ where: { organizationId }, include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] }] }),
      models.TeamInvitation.findAll({ where: { organizationId, acceptedAt: null, expiresAt: { [Op.gt]: new Date() } }, attributes: ['id', 'email', 'phone', 'role', 'expiresAt', 'createdAt'], order: [['createdAt', 'DESC']] }),
    ]);
    const promoters = affiliates.filter((affiliate) => affiliate.status === 'active' && !affiliate.code.endsWith('-STAFF'));
    return { leaders, employees, affiliates: promoters, people: rosterPeople(leaders, employees, promoters), invitations };
  }
  async function invite(userId, organizationId, input) {
    const organization = await assertManager(userId, organizationId);
    if (input.role === 'manager') await permissions.assertOwnOrganization(userId, organizationId);
    const email = input.email.trim().toLowerCase();
    const token = crypto.randomBytes(32).toString('base64url');
    const invitation = await models.TeamInvitation.create({ organizationId, invitedByUserId: userId, email, phone: input.phone, role: input.role, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000) });
    await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'TeamInvitation', entityId: invitation.id, action: 'team.invited', after: { email, role: input.role } });
    // Future Twilio invitation delivery belongs after the invitation is saved.
    // Send only when the inviter explicitly chooses SMS, and log delivery status;
    // this inviter supplied number is never copied to the invitee's User record.
    return { id: invitation.id, organizationName: organization.name, email, phone: invitation.phone, role: input.role, token, expiresAt: invitation.expiresAt };
  }
  async function invitation(token) {
    const row = await models.TeamInvitation.findOne({ where: { tokenHash: hash(token), acceptedAt: null, expiresAt: { [Op.gt]: new Date() } }, include: [{ model: models.Organization, as: 'organization', attributes: ['id', 'name'] }, { model: models.Event, as: 'event', attributes: ['id','title','endsAt','status'] }] });
    if (!row) throw notFound('Active invitation');
    if (row.eventId) assertEventEditable(row.event);
    return { email: row.email, phone: row.phone, role: row.role, organizationName: row.organization?.name, eventId:row.eventId, eventTitle:row.event?.title, commissionBps:row.commissionBps, expiresAt: row.expiresAt };
  }
  async function eventInvitations(userId, eventId) {
    await permissions.assertManageEvent(userId,eventId);
    return models.TeamInvitation.findAll({where:{eventId,acceptedAt:null,expiresAt:{[Op.gt]:new Date()}},attributes:['id','email','phone','expiresAt','commissionBps'],order:[['createdAt','DESC']]});
  }
  async function inviteEvent(userId, eventId, input) {
    await permissions.assertManageEvent(userId,eventId);
    return models.TeamInvitation.sequelize.transaction(async (transaction) => {
      const event = await models.Event.findByPk(eventId,{transaction,lock:transaction.LOCK.UPDATE});
      assertEventEditable(event);
      const email = input.email.trim().toLowerCase();
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Math.min(Date.now()+7*86400000,new Date(event.endsAt).getTime()));
      // Renew pending invitations so repeated sends leave only one valid link.
      const pending = await models.TeamInvitation.findOne({where:{eventId,email,acceptedAt:null},transaction,lock:transaction.LOCK.UPDATE});
      const values = {tokenHash:hash(token),expiresAt,invitedByUserId:userId,phone:input.phone,commissionBps:input.commissionBps ?? 0};
      const row = pending ? await pending.update(values,{transaction}) : await models.TeamInvitation.create({...values,eventId,organizationId:null,email,role:'affiliate'},{transaction});
      await models.AuditLog.create({actorUserId:userId,organizationId:event.organizationId,entityType:'TeamInvitation',entityId:row.id,action:'event.promoter.invited',after:{eventId,email,commissionBps:values.commissionBps}},{transaction});
      // Future Twilio send can use row.phone only after an explicit SMS send action.
      return {id:row.id,eventId,eventTitle:event.title,email,phone:row.phone,role:'affiliate',commissionBps:values.commissionBps,token,expiresAt,delivery:'manual'};
    });
  }
  async function revokeEvent(userId,eventId,invitationId) {
    await permissions.assertManageEvent(userId,eventId);
    const row = await models.TeamInvitation.findOne({where:{id:invitationId,eventId,acceptedAt:null}});
    if (!row) throw notFound('Pending invitation');
    await row.update({expiresAt:new Date(0)});
    return {revoked:true};
  }
  async function revoke(userId, organizationId, invitationId) {
    await assertManager(userId, organizationId);
    const row = await models.TeamInvitation.findOne({ where: { id: invitationId, organizationId, acceptedAt: null } });
    if (!row) throw notFound('Pending invitation');
    if (row.role === 'manager') await permissions.assertOwnOrganization(userId, organizationId);
    await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'TeamInvitation', entityId: row.id, action: 'team.invitation.revoked', before: { email: row.email, role: row.role } });
    await row.destroy();
    return { revoked: true };
  }
  async function resend(userId, organizationId, invitationId) {
    const organization = await assertManager(userId, organizationId);
    const row = await models.TeamInvitation.findOne({ where: { id: invitationId, organizationId, acceptedAt: null } });
    if (!row) throw notFound('Pending invitation');
    if (row.role === 'manager') await permissions.assertOwnOrganization(userId, organizationId);
    const token = crypto.randomBytes(32).toString('base64url');
    await row.update({ tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000) });
    await models.AuditLog.create({ actorUserId: userId, organizationId, entityType: 'TeamInvitation', entityId: row.id, action: 'team.invitation.renewed', after: { email: row.email, role: row.role } });
    return { email: row.email, phone: row.phone, role: row.role, organizationName: organization.name, token, expiresAt: row.expiresAt };
  }
  async function accept(userId, token) {
    return models.TeamInvitation.sequelize.transaction(async (transaction) => {
      // Use the same event → invitation lock order as issuing/renewing a link.
      const scope = await models.TeamInvitation.findOne({where:{tokenHash:hash(token)},transaction});
      if (scope?.eventId) await models.Event.findByPk(scope.eventId,{transaction,lock:transaction.LOCK.UPDATE});
      const row = await models.TeamInvitation.findOne({ where: { tokenHash: hash(token) }, transaction, lock: transaction.LOCK.UPDATE });
      if (!row || row.acceptedAt || row.expiresAt <= new Date()) throw notFound('Active invitation');
      const user = await models.User.findByPk(userId, { transaction });
      if (!user || user.email.toLowerCase() !== row.email) throw forbidden('Sign in with the invited email address');
      if (row.eventId) {
        if (!user.isActive || row.role !== 'affiliate') throw forbidden();
        const event = await models.Event.findByPk(row.eventId,{transaction,lock:transaction.LOCK.UPDATE});
        assertEventEditable(event);
        await permissions.assertManageEvent(row.invitedByUserId,row.eventId);
        const inviter = await models.User.findByPk(row.invitedByUserId,{transaction});
        if (!inviter?.isActive) throw forbidden('The inviter no longer has access');
        const [assignment,created] = await models.EventAffiliate.findOrCreate({where:{eventId:row.eventId,userId},defaults:{code:`NW-${crypto.randomUUID()}`,commissionBps:row.commissionBps,guestlistAllocation:0,status:'active'},transaction});
        const before = created ? null : assignment.toJSON();
        if (!created) await assignment.update({status:'active',commissionBps:row.commissionBps},{transaction});
        await models.AuditLog.create({actorUserId:userId,organizationId:event.organizationId,entityType:'EventAffiliate',entityId:assignment.id,action:'event.promoter.invitation_terms_accepted',before,after:assignment.toJSON()},{transaction});
        await row.update({acceptedAt:new Date(),acceptedByUserId:userId},{transaction});
        await models.AuditLog.create({actorUserId:userId,organizationId:event.organizationId,entityType:'TeamInvitation',entityId:row.id,action:'event.promoter.accepted',after:{eventId:row.eventId,userId}},{transaction});
        return {eventId:row.eventId,role:'affiliate'};
      } else if (row.role === 'employee') {
        const membership = await models.OrganizationEmployee.findOne({ where: { organizationId: row.organizationId, userId }, transaction });
        if (membership) await membership.update({ status: 'active' }, { transaction });
        else await models.OrganizationEmployee.create({ organizationId: row.organizationId, userId, status: 'active' }, { transaction });
      } else if (row.role === 'manager') {
        const membership = await models.OrganizationOwner.findOne({ where: { organizationId: row.organizationId, userId }, transaction });
        if (!membership) await models.OrganizationOwner.create({ organizationId: row.organizationId, userId, role: 'admin' }, { transaction });
      } else if (row.role === 'affiliate') {
        const affiliate = await models.OrgAffiliate.findOne({ where: { organizationId: row.organizationId, userId }, transaction });
        if (affiliate) await affiliate.update({ status: 'active' }, { transaction });
        else await models.OrgAffiliate.create({ organizationId: row.organizationId, userId, code: `org-${crypto.randomUUID()}`, defaultCommissionBps: 0, defaultGuestlistAllocation: 0 }, { transaction });
      } else throw conflict('Invalid invitation role');
      await row.update({ acceptedAt: new Date(), acceptedByUserId: userId }, { transaction });
      await models.AuditLog.create({ actorUserId: userId, organizationId: row.organizationId, entityType: 'TeamInvitation', entityId: row.id, action: 'team.invitation.accepted', after: { role: row.role, userId } }, { transaction });
      return { organizationId: row.organizationId, role: row.role };
    });
  }
  return { roster, invite, invitation, accept, revoke, resend, inviteEvent, eventInvitations, revokeEvent };
}
module.exports = { createTeamService, rosterPeople };
