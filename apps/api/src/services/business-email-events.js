const { TEMPLATES } = require('./email-templates');
const { accessScope } = require('./event-affiliate-access');
const { activeUser } = require('./lifecycle-service');

const name = (user) => user?.displayName?.trim() || 'there';
const percent = (bps) => `${(Number(bps || 0) / 100).toFixed(2).replace(/\.00$/, '')}%`;
const expiresAt = (value) => `${new Date(value).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`;
const makeUrl = (base, params = {}, pathname = '/app') => {
  const url = new URL(pathname, base);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  return url.toString();
};

async function queueBusinessMessage({ email, to, template, key, variables, transaction }) {
  if (!email?.enabled || !to) return null;
  return email.queue({ key, to, template, variables }, transaction);
}

async function queueTeamInvitation({ email, invitation, organization, token, businessAppUrl, transaction }) {
  return queueBusinessMessage({ email, to: invitation.email, template: TEMPLATES.teamInvitation,
    key: `team-invite/${invitation.id}/${invitation.tokenHash}`, transaction,
    variables: { ORGANIZATION: organization.name, ROLE: invitation.role, EXPIRES_AT: expiresAt(invitation.expiresAt),
      ACCEPT_URL: makeUrl(businessAppUrl, { invite: token }, '/') } });
}

async function queuePromoterInvitation({ email, invitation, event, token, businessAppUrl, transaction }) {
  return queueBusinessMessage({ email, to: invitation.email, template: TEMPLATES.promoterInvitation,
    key: `promoter-invite/${invitation.id}/${invitation.tokenHash}`, transaction,
    variables: { EVENT_TITLE: event.title, COMMISSION: percent(invitation.commissionBps), EXPIRES_AT: expiresAt(invitation.expiresAt),
      ACCEPT_URL: makeUrl(businessAppUrl, { invite: token }, '/') } });
}

async function queueAccessAccepted({ email, models, invitation, invitee, context, transaction }) {
  if (!email?.enabled) return null;
  const inviter = await models.User.findByPk(invitation.invitedByUserId, { transaction });
  return queueBusinessMessage({ email, to: inviter?.email, template: TEMPLATES.accessAccepted,
    key: `access-accepted/${invitation.id}/${invitee.id}`, transaction,
    variables: { INVITEE: name(invitee), CONTEXT: context, ROLE: invitation.role } });
}

async function queueAccessChanged({ email, models, userId, organization, oldRole, newRole, actionId, businessAppUrl, transaction }) {
  if (!email?.enabled || oldRole === newRole) return null;
  const user = await models.User.findByPk(userId, { transaction });
  return queueBusinessMessage({ email, to: user?.email, template: TEMPLATES.accessChanged,
    key: `access-changed/${actionId}`, transaction,
    variables: { NAME: name(user), ORGANIZATION: organization.name, OLD_ROLE: oldRole, NEW_ROLE: newRole,
      EFFECTIVE_AT: new Date().toISOString(), BUSINESS_URL: makeUrl(businessAppUrl) } });
}

async function queueEventTermsChanged({ email, models, userId, event, term, oldValue, newValue, actionId, businessAppUrl, transaction }) {
  if (!email?.enabled || String(oldValue) === String(newValue)) return null;
  const user = await models.User.findByPk(userId, { transaction });
  return queueBusinessMessage({ email, to: user?.email, template: TEMPLATES.eventTermsChanged,
    key: `event-terms/${actionId}`, transaction,
    variables: { NAME: name(user), EVENT_TITLE: event.title, TERM: term, OLD_VALUE: String(oldValue), NEW_VALUE: String(newValue),
      EFFECTIVE_AT: new Date().toISOString(), EVENT_URL: makeUrl(businessAppUrl, { event: event.id }) } });
}

async function queueGuestlistReviewNeeded({ email, models, reviewerIds, entry, event, businessAppUrl, transaction }) {
  if (!email?.enabled || !reviewerIds.length) return 0;
  const reviewers = await models.User.findAll({ where: { id: [...new Set(reviewerIds)], isActive: true }, transaction });
  for (const reviewer of reviewers) await queueBusinessMessage({ email, to: reviewer.email, template: TEMPLATES.guestlistReviewNeeded,
    key: `guestlist-review/${entry.id}/${reviewer.id}`, transaction,
    variables: { NAME: name(reviewer), EVENT_TITLE: event.title, SPOTS: String(entry.partySize),
      REVIEW_URL: makeUrl(businessAppUrl, { event: event.id, tab: 'guestlist', entry: entry.id }) } });
  return reviewers.length;
}

async function queueBusinessEventStatus({ email, models, event, change, details, actionId, businessAppUrl, transaction }) {
  if (!email?.enabled) return 0;
  const leaders = event.organizationId && models.OrganizationOwner?.findAll
    ? await models.OrganizationOwner.findAll({ where: { organizationId: event.organizationId }, attributes: ['userId'], transaction }) : [];
  const team = models.EventAffiliate?.findAll
    ? await models.EventAffiliate.findAll({ where: { eventId: event.id, status: 'active' }, attributes: ['userId', 'code', 'accessScope', 'orgAffiliateId', 'sourceOrgAffiliateId'], transaction }) : [];
  let eligibleTeam = team;
  if (event.organizationId && team.some((member) => accessScope(member) === 'organization')) {
    const staff = models.OrganizationEmployee?.findAll ? await models.OrganizationEmployee.findAll({ where: { organizationId: event.organizationId, status: 'active' }, attributes: ['userId'], transaction }) : [];
    const promoters = models.OrgAffiliate?.findAll ? await models.OrgAffiliate.findAll({ where: { organizationId: event.organizationId, status: 'active' }, attributes: ['userId', 'startsAt', 'endsAt'], transaction }) : [];
    const leaderIds = new Set(leaders.map((member) => member.userId));
    const staffIds = new Set(staff.map((member) => member.userId));
    const current = new Date();
    const promoterIds = new Set(promoters.filter((member) => (!member.startsAt || member.startsAt <= current) && (!member.endsAt || member.endsAt >= current)).map((member) => member.userId));
    eligibleTeam = team.filter((member) => accessScope(member) === 'event' || leaderIds.has(member.userId) || staffIds.has(member.userId) || promoterIds.has(member.userId));
  }
  const ids = [...new Set([...(event.organizationId ? [] : [event.creatorUserId]), ...leaders.map((row) => row.userId), ...eligibleTeam.map((row) => row.userId)].filter(Boolean))];
  if (!ids.length) return 0;
  const users = await models.User.findAll({ where: { id: ids, isActive: true }, transaction });
  const recipients = users.filter(activeUser);
  for (const user of recipients) await queueBusinessMessage({ email, to: user.email, template: TEMPLATES.businessEventStatus,
    key: `business-event/${event.id}/${actionId}/${user.id}`, transaction,
    variables: { NAME: name(user), EVENT_TITLE: event.title, CHANGE: change, DETAILS: details,
      EVENT_URL: makeUrl(businessAppUrl, { event: event.id }) } });
  return recipients.length;
}

async function queueInstructionsSent({ email, models, userId, event, count, actionId, businessAppUrl, transaction }) {
  if (!email?.enabled) return null;
  const sender = await models.User.findByPk(userId, { transaction });
  return queueBusinessMessage({ email, to: sender?.email, template: TEMPLATES.instructionsSent,
    key: `instructions-sent/${actionId}`, transaction,
    variables: { NAME: name(sender), EVENT_TITLE: event.title, RECIPIENT_COUNT: String(count), DELIVERY_STATUS: 'Queued for delivery',
      EVENT_URL: makeUrl(businessAppUrl, { event: event.id }) } });
}

module.exports = { queueTeamInvitation, queuePromoterInvitation, queueAccessAccepted, queueAccessChanged,
  queueEventTermsChanged, queueGuestlistReviewNeeded, queueBusinessEventStatus, queueInstructionsSent, makeUrl, percent };
