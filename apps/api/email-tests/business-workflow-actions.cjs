const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createTeamService } = require('../src/services/team-service');
const { createEventWorkspaceService } = require('../src/services/event-workspace-service');
const { createManagementController } = require('../src/controllers/management-controller');
const { createGuestlistService } = require('../src/services/guestlist-service');
const { createBusinessService } = require('../src/services/business-service');
const { sendAttendeeInstructions } = require('../src/services/attendee-instructions-service');
const { TEMPLATES } = require('../src/services/email-templates');

const BUSINESS_URL = 'https://business.nitewide.example/';
const CUSTOMER_URL = 'https://nitewide.example/';
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const address = (label, run) => `delivered+business-${label}-${run}@resend.dev`;
const sequelize = { transaction: async (options, work) => (typeof options === 'function' ? options : work)({ LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' } }), query: async () => [{ rate: 0 }] };
const row = (values) => ({ ...values, async update(changes) { Object.assign(this, changes); return this; },
  async destroy() { this.status = 'destroyed'; }, toJSON() { return { ...this }; } });
const BUSINESS_TEMPLATES = new Set([
  TEMPLATES.teamInvitation, TEMPLATES.promoterInvitation, TEMPLATES.accessAccepted,
  TEMPLATES.accessChanged, TEMPLATES.eventTermsChanged, TEMPLATES.guestlistReviewNeeded,
  TEMPLATES.businessEventStatus, TEMPLATES.instructionsSent,
]);

async function collectBusinessWorkflowMessages(run) {
  const messages = [];
  const email = { enabled: true, async queue(message) {
    assert.match(message.to, /^delivered\+business-[a-z0-9-]+@resend\.dev$/);
    if (!BUSINESS_TEMPLATES.has(message.template)) return 'customer-suite';
    messages.push({ ...message });
    return String(messages.length);
  } };
  async function action(label, template, perform) {
    const before = messages.length;
    await perform();
    assert.equal(messages.length, before + 1, `${label} should queue exactly one business email`);
    assert.equal(messages[before].template, template, `${label} queued the wrong template`);
    messages[before].action = label;
  }

  // Organization and event invitation actions, acceptance, role change, removal.
  {
    const organization = { id: `org-${run}`, name: 'Test organization', status: 'active' };
    const event = { id: `team-event-${run}`, title: 'Test event', organizationId: organization.id,
      status: 'published', startsAt: future(48), endsAt: future(52) };
    const inviter = { id: 'manager', email: address('manager', run), displayName: 'Test manager', isActive: true };
    const member = { id: 'member', email: address('member', run), displayName: 'Test member', isActive: true };
    const promoter = { id: 'promoter', email: address('promoter', run), displayName: 'Test promoter', isActive: true };
    const users = new Map([inviter, member, promoter].map((user) => [user.id, user]));
    const invitations = [];
    let orgRole = 'employee';
    let employee = row({ status: 'active' });
    let affiliate = null;
    let assignment = null;
    const models = {
      Organization: { sequelize, findByPk: async () => organization },
      Event: { findByPk: async () => event, findAll: async () => [] },
      User: { findByPk: async (id) => users.get(id) || null },
      TeamInvitation: {
        sequelize,
        create: async (values) => { const invite = row({ id: `invitation-${invitations.length + 1}-${run}`, ...values, acceptedAt: null }); invitations.push(invite); return invite; },
        findOne: async ({ where }) => invitations.find((invite) => (where.eventId ? invite.eventId === where.eventId && invite.email === where.email && !invite.acceptedAt
          : invite.tokenHash === where.tokenHash)) || null,
      },
      OrganizationOwner: {
        findOne: async ({ where }) => where.userId === member.id && orgRole === 'manager' ? row({ role: 'admin', destroy: async () => { orgRole = 'none'; } }) : null,
        unscoped() { return this; },
        create: async () => { orgRole = 'manager'; return row({ role: 'admin' }); },
      },
      OrganizationEmployee: { findOne: async ({ where }) => where.userId === member.id ? employee : null,
        create: async () => { employee = row({ status: 'active' }); orgRole = 'employee'; return employee; } },
      OrgAffiliate: { findOne: async () => affiliate, create: async () => { affiliate = row({ status: 'active' }); return affiliate; } },
      EventAffiliate: { findOrCreate: async () => { assignment = row({ id: `assignment-${run}`, status: 'active', commissionBps: 500 }); return [assignment, true]; },
        findAll: async () => [] },
      AuditLog: { create: async () => ({ id: `audit-team-${crypto.randomUUID()}` }) },
    };
    const permissions = { assertManageOrganization: async () => organization, assertManageEvent: async () => event };
    const team = createTeamService({ models, permissions, email, businessAppUrl: BUSINESS_URL });
    let orgInvite;
    await action('invite organization member', TEMPLATES.teamInvitation, async () => {
      orgInvite = await team.invite(inviter.id, organization.id, { email: member.email, role: 'employee', phone: null });
    });
    let promoterInvite;
    await action('invite event promoter', TEMPLATES.promoterInvitation, async () => {
      promoterInvite = await team.inviteEvent(inviter.id, event.id, { email: promoter.email, commissionBps: 0, phone: null });
    });
    await action('accept organization invitation', TEMPLATES.accessAccepted, () => team.accept(member.id, orgInvite.token));
    await action('accept promoter invitation', TEMPLATES.accessAccepted, () => team.accept(promoter.id, promoterInvite.token));
    await action('change organization role', TEMPLATES.accessChanged, () => team.changeRole(inviter.id, organization.id, member.id, 'manager'));
    await action('remove organization member', TEMPLATES.accessChanged, () => team.removeMember(inviter.id, organization.id, member.id));
  }

  // Event commission edit via the same event-workspace action used by the UI.
  {
    const person = { id: `terms-user-${run}`, email: address('terms', run), displayName: 'Test promoter', isActive: true };
    const event = { id: `terms-event-${run}`, title: 'Terms test event', organizationId: null, status: 'published', endsAt: future(52) };
    const assignment = row({ id: `terms-assignment-${run}`, userId: person.id, eventId: event.id,
      commissionBps: 500, guestlistAllocation: 5, status: 'active' });
    let auditNumber = 0;
    const models = {
      User: { findByPk: async () => person }, Event: { sequelize, findByPk: async () => event },
      EventAffiliate: { findOne: async () => assignment }, AuditLog: { create: async () => ({ id: `terms-audit-${++auditNumber}-${run}` }) },
    };
    const permissions = { assertManageEvent: async () => event };
    const workspace = createEventWorkspaceService({ models, permissions, email, businessAppUrl: BUSINESS_URL });
    await action('change event commission', TEMPLATES.eventTermsChanged, () => workspace.savePerson('manager', event.id,
      { userId: person.id, commissionBps: 0, status: 'active' }));
    const controller = createManagementController({ models: {
      ...models,
      EventAffiliate: { findOne: async () => assignment },
      GuestlistEntry: { sum: async () => 0 },
    }, permissions, email, businessAppUrl: BUSINESS_URL });
    await action('change guestlist allocation', TEMPLATES.eventTermsChanged, () => controller.updateAffiliateGuestlistAllocation(
      { userId: 'manager', params: { eventId: event.id, eventAffiliateId: assignment.id }, body: { guestlistAllocation: 8 } },
      { json: () => {} }));
  }

  // Guestlist request emails are opt-in for reviewers; customer email is ignored here.
  {
    const guest = { id: `guest-${run}`, email: address('guest', run), displayName: 'Test guest', isActive: true };
    const reviewer = { id: `reviewer-${run}`, email: address('reviewer', run), displayName: 'Test reviewer', isActive: true };
    const event = { id: `guest-event-${run}`, title: 'Review test event', status: 'published', organizationId: null,
      creatorUserId: reviewer.id, startsAt: future(48), endsAt: future(52) };
    const models = {
      Event: { findByPk: async () => event }, User: { findByPk: async () => guest, findAll: async () => [reviewer] },
      GuestlistEntry: { findOne: async () => null, sum: async () => 0, create: async (values) => row({ id: `entry-${run}`, ...values }) },
      EventAffiliate: {}, OrgAffiliate: {},
      AffiliateAttribution: { create: async () => ({}) }, AuditLog: { create: async () => ({}) },
    };
    const service = createGuestlistService({ sequelize, models, email, customerAppUrl: CUSTOMER_URL,
      businessAppUrl: BUSINESS_URL, reviewEmailsEnabled: true });
    await action('guestlist request awaits review', TEMPLATES.guestlistReviewNeeded,
      () => service.request({ eventId: event.id, userId: guest.id, partySize: 2 }));
  }

  // Event publication and material changes use the real saveEvent workflow.
  function eventFixture(kind) {
    const manager = { id: `event-manager-${kind}-${run}`, email: address(`event-${kind}`, run), displayName: 'Test manager', isActive: true };
    const oldLocation = { id: `old-location-${kind}-${run}`, name: 'Test venue', addressLine1: '100 First St', city: 'Orlando', region: 'FL', timezone: 'America/New_York' };
    const locations = new Map([[oldLocation.id, oldLocation]]);
    const event = row({ id: `event-${kind}-${run}`, title: 'Business status test event', creatorUserId: manager.id,
      organizationId: null, status: kind === 'publish' ? 'draft' : 'published', version: 1,
      locationId: oldLocation.id, startsAt: future(48), endsAt: future(52) });
    event.update = async function update(values) { Object.assign(this, values); this.version++; return this; };
    const models = {
      Event: { sequelize, findByPk: async () => event }, Offering: { findAll: async () => [] },
      Location: { findByPk: async (id) => locations.get(id) || null,
        create: async (values) => { const location = { id: `new-location-${kind}-${run}`, ...values }; locations.set(location.id, location); return location; } },
      GuestlistEntry: { sum: async () => 0, findAll: async () => [] },
      Ticket: { count: async () => 0 },
      Order: { findAll: async () => [] },
      User: { findAll: async () => [manager], findByPk: async () => manager },
      EventAffiliate: { findAll: async () => [] },
      AuditLog: { create: async () => ({ id: `event-audit-${kind}-${run}` }) },
    };
    const input = { version: 1, organizationId: null, title: event.title, summary: '', description: '', category: 'nightlife',
      startsAt: event.startsAt, endsAt: event.endsAt, status: kind === 'publish' ? 'published' : event.status,
      isDiscoverable: false, guestlistCapacity: 10, capacity: 20,
      location: { name: oldLocation.name, addressLine1: oldLocation.addressLine1, city: oldLocation.city, region: oldLocation.region,
        postalCode: '32801', countryCode: 'US', timezone: oldLocation.timezone, privacy: 'public' }, offerings: [] };
    return { event, manager, models, input, permissions: { assertManageEvent: async () => event } };
  }
  for (const [kind, label, mutate] of [
    ['publish', 'publish event', () => {}],
    ['cancel', 'cancel event', (input) => { input.status = 'cancelled'; }],
    ['time', 'material event time change', (input) => { input.startsAt = future(49); input.endsAt = future(53); }],
    ['venue', 'material event venue change', (input) => { input.location.addressLine1 = '200 Second St'; }],
  ]) {
    const fixture = eventFixture(kind);
    mutate(fixture.input);
    const service = createBusinessService({ models: fixture.models, permissions: fixture.permissions,
      email, customerAppUrl: CUSTOMER_URL, businessAppUrl: BUSINESS_URL });
    await action(label, TEMPLATES.businessEventStatus, () => service.saveEvent(fixture.manager.id, fixture.event.id, fixture.input));
  }
  {
    const fixture = eventFixture('instructions');
    fixture.models.Order.findAll = async () => [{ id: `order-${run}`, buyerUserId: fixture.manager.id }];
    await action('send attendee instructions', TEMPLATES.instructionsSent,
      () => sendAttendeeInstructions({ models: fixture.models, permissions: fixture.permissions, email,
        customerAppUrl: CUSTOMER_URL, businessAppUrl: BUSINESS_URL, userId: fixture.manager.id,
        eventId: fixture.event.id, instructions: 'Please bring your entry pass.' }));
  }
  assert.equal(messages.length, 14);
  return messages;
}

module.exports = { collectBusinessWorkflowMessages, BUSINESS_TEMPLATES };
