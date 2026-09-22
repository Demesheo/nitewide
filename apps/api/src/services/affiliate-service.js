const { randomUUID } = require('node:crypto');
const { DomainError } = require('../domain/errors');

const employeeReferralCode = (membershipId) => `STAFF-${membershipId}`;
const leaderReferralCode = (membershipId) => `LEAD-${membershipId}`;
const invalidCode = () => new DomainError('Promoter code is invalid or inactive', { code: 'INVALID_AFFILIATE' });

async function resolveVenueMember(models, { event, code, now, transaction, lock }) {
  const leader = code.startsWith('LEAD-');
  if (!event.organizationId || !/^(STAFF|LEAD)-[0-9a-f-]{36}$/i.test(code)) throw invalidCode();
  const common = { transaction, ...(lock ? { lock } : {}) };
  const membership = await (leader ? models.OrganizationOwner : models.OrganizationEmployee).findOne({ where: { id: code.slice(leader ? 5 : 6), organizationId: event.organizationId, ...(!leader ? {status:'active'} : {}) }, ...common });
  if (!membership || !(await models.User.findByPk(membership.userId, common))?.isActive) throw invalidCode();
  let eventAffiliate = await models.EventAffiliate.findOne({ where: { eventId: event.id, userId: membership.userId }, ...common });
  if (!eventAffiliate) {
    // Persist attribution only when used, not for every team member × event.
    [eventAffiliate] = await models.EventAffiliate.findOrCreate({ where: { eventId: event.id, userId: membership.userId }, defaults: { code: `${leader ? 'LEADEV' : 'STAFFEV'}-${randomUUID()}`, commissionBps: 0, guestlistAllocation: 0, status: 'active' }, transaction });
  }
  if (!isActiveWindow(eventAffiliate, now)) throw invalidCode();
  return { eventAffiliate, orgAffiliate: null, commissionBps: eventAffiliate.commissionBps ?? 0, guestlistAllocation: eventAffiliate.guestlistAllocation ?? 0 };
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
    if (orgAffiliate) eventAffiliate = await models.EventAffiliate.findOne({ where: { eventId: event.id, userId: orgAffiliate.userId }, ...common });
  }
  if ((!eventAffiliate && !orgAffiliate) || (eventAffiliate && !isActiveWindow(eventAffiliate, now)) || (orgAffiliate && !isActiveWindow(orgAffiliate, now))) {
    throw new DomainError('Promoter code is invalid or inactive', { code: 'INVALID_AFFILIATE' });
  }
  const referrerId = eventAffiliate?.userId || orgAffiliate?.userId;
  if (!referrerId || !(await models.User.findByPk(referrerId, common))?.isActive) throw invalidCode();
  // Auto-created team event codes stop working when membership/account ends.
  if (eventAffiliate?.code?.startsWith('STAFFEV-') || eventAffiliate?.code?.startsWith('LEADEV-')) {
    const leader = eventAffiliate.code.startsWith('LEADEV-');
    const membership = await (leader ? models.OrganizationOwner : models.OrganizationEmployee).findOne({ where: { organizationId: event.organizationId, userId: eventAffiliate.userId, ...(!leader ? {status:'active'} : {}) }, ...common });
    if (!membership || !(await models.User.findByPk(eventAffiliate.userId, common))?.isActive) throw invalidCode();
  }
  return {
    eventAffiliate,
    orgAffiliate,
    commissionBps: eventAffiliate?.commissionBps ?? orgAffiliate?.defaultCommissionBps ?? 0,
    guestlistAllocation: eventAffiliate?.guestlistAllocation ?? orgAffiliate?.defaultGuestlistAllocation ?? 0,
  };
}
module.exports = { resolveAffiliate, isActiveWindow, employeeReferralCode, leaderReferralCode };
