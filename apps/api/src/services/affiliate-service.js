const { randomUUID } = require('node:crypto');
const { DomainError } = require('../domain/errors');
const { accessScope, currentOrganizationMembership } = require('./event-affiliate-access');
const { activeUser } = require('./lifecycle-service');

const employeeReferralCode = (membershipId) => `STAFF-${membershipId}`;
const leaderReferralCode = (membershipId) => `LEAD-${membershipId}`;
const invalidCode = () => new DomainError('Promoter code is invalid or inactive', { code: 'INVALID_AFFILIATE' });

async function resolveVenueMember(models, { event, code, now, transaction, lock }) {
  const leader = code.startsWith('LEAD-');
  if (!event.organizationId || !/^(STAFF|LEAD)-[0-9a-f-]{36}$/i.test(code)) throw invalidCode();
  const common = { transaction, ...(lock ? { lock } : {}) };
  const model = leader ? models.OrganizationOwner.unscoped() : models.OrganizationEmployee;
  const membership = await model.findOne({ where: { id: code.slice(leader ? 5 : 6), organizationId: event.organizationId }, ...common });
  const current = membership && await currentOrganizationMembership(models, event.organizationId, membership.userId, transaction, now);
  if (!current) throw invalidCode();
  let eventAffiliate = await models.EventAffiliate.findOne({ where: { eventId: event.id, userId: membership.userId }, ...common });
  if (!eventAffiliate) {
    // Persist attribution only when used, not for every team member × event.
    [eventAffiliate] = await models.EventAffiliate.findOrCreate({ where: { eventId: event.id, userId: membership.userId }, defaults: {
      code: `${leader ? 'LEADEV' : 'STAFFEV'}-${randomUUID()}`,
      orgAffiliateId: current.kind === 'affiliate' ? current.record.id : null,
      commissionBps: current.kind === 'affiliate' ? null : 0,
      guestlistAllocation: current.kind === 'affiliate' ? null : 0,
      status: 'active', accessScope: 'organization',
    }, transaction });
  }
  if (accessScope(eventAffiliate) !== 'organization') throw invalidCode();
  if (!isActiveWindow(eventAffiliate, now)) throw invalidCode();
  const linked = eventAffiliate.orgAffiliateId ? await models.OrgAffiliate.findByPk(eventAffiliate.orgAffiliateId, common) : null;
  if (linked && !isActiveWindow(linked, now)) throw invalidCode();
  return { eventAffiliate, orgAffiliate: linked, commissionBps: eventAffiliate.commissionBps ?? linked?.defaultCommissionBps ?? 0,
    guestlistAllocation: eventAffiliate.guestlistAllocation ?? linked?.defaultGuestlistAllocation ?? 0 };
}

function isActiveWindow(record, now) {
  return record && record.status === 'active' && (!record.startsAt || record.startsAt <= now) && (!record.endsAt || record.endsAt >= now);
}

async function resolveAffiliate(models, { event, code, now = new Date(), transaction, lock }) {
  if (!code) return { commissionBps: 0, guestlistAllocation: 0, orgAffiliate: null, eventAffiliate: null };
  if (code.startsWith('STAFF-') || code.startsWith('LEAD-')) return resolveVenueMember(models, { event, code, now, transaction, lock });
  const common = { transaction, ...(lock ? { lock } : {}) };
  let eventAffiliate = await models.EventAffiliate.findOne({ where: { eventId: event.id, code }, ...common });
  let orgAffiliate = eventAffiliate?.orgAffiliateId ? await models.OrgAffiliate.findByPk(eventAffiliate.orgAffiliateId, common) : null;
  if (!eventAffiliate && event.organizationId) {
    orgAffiliate = await models.OrgAffiliate.findOne({ where: { organizationId: event.organizationId, code }, ...common });
    if (orgAffiliate) {
      const membership = await currentOrganizationMembership(models, event.organizationId, orgAffiliate.userId, transaction, now);
      if (!membership) throw invalidCode();
      [eventAffiliate] = await models.EventAffiliate.findOrCreate({ where: { eventId: event.id, userId: orgAffiliate.userId },
        defaults: { code: `NW-${randomUUID()}`, orgAffiliateId: membership.kind === 'affiliate' ? membership.record.id : null,
          sourceOrgAffiliateId: membership.kind === 'affiliate' ? null : orgAffiliate.id,
          commissionBps: membership.kind === 'affiliate' ? null : 0,
          guestlistAllocation: membership.kind === 'affiliate' ? null : 0,
          status: 'active', accessScope: 'organization' }, transaction });
      if (accessScope(eventAffiliate) !== 'organization') throw invalidCode();
      orgAffiliate = eventAffiliate.orgAffiliateId ? await models.OrgAffiliate.findByPk(eventAffiliate.orgAffiliateId, common) : null;
    }
  }
  if ((!eventAffiliate && !orgAffiliate) || (eventAffiliate && !isActiveWindow(eventAffiliate, now)) || (orgAffiliate && !isActiveWindow(orgAffiliate, now))) {
    throw new DomainError('Promoter code is invalid or inactive', { code: 'INVALID_AFFILIATE' });
  }
  const referrerId = eventAffiliate?.userId || orgAffiliate?.userId;
  if (!referrerId || !activeUser(await models.User.findByPk(referrerId, common))) throw invalidCode();
  if (eventAffiliate && accessScope(eventAffiliate) === 'organization' &&
      !await currentOrganizationMembership(models, event.organizationId, eventAffiliate.userId, transaction, now)) throw invalidCode();
  return {
    eventAffiliate,
    orgAffiliate,
    commissionBps: eventAffiliate?.commissionBps ?? orgAffiliate?.defaultCommissionBps ?? 0,
    guestlistAllocation: eventAffiliate?.guestlistAllocation ?? orgAffiliate?.defaultGuestlistAllocation ?? 0,
  };
}
module.exports = { resolveAffiliate, isActiveWindow, employeeReferralCode, leaderReferralCode };
