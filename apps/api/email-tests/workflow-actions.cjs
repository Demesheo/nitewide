const assert = require('node:assert/strict');
const { createAuthService } = require('../src/services/auth-service');
const { createCheckoutService } = require('../src/services/checkout-service');
const { createGuestlistService } = require('../src/services/guestlist-service');
const { createBusinessService } = require('../src/services/business-service');
const { sendAttendeeInstructions } = require('../src/services/attendee-instructions-service');
const { TEMPLATES } = require('../src/services/email-templates');
const CUSTOMER_TEMPLATES = new Set([
  TEMPLATES.verifyEmail, TEMPLATES.welcome, TEMPLATES.passwordReset, TEMPLATES.purchaseReceipt,
  TEMPLATES.guestlistReceived, TEMPLATES.guestlistApproved, TEMPLATES.guestlistDeclined,
  TEMPLATES.eventCancelled, TEMPLATES.eventTimeChange, TEMPLATES.eventVenueChange, TEMPLATES.eventInstructions,
]);

const APP_URL = 'https://nitewide.example/';
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const recipient = (label, runLabel) => `delivered+${label}-${runLabel}@resend.dev`;
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const sequelize = { transaction: async (options, work) => typeof options === 'function' ? options(transaction) : work(transaction) };

// Action fixtures never touch a database, payment processor, or real customer.
// They invoke the same service methods used by the API and capture their queued
// messages. The opt-in runner sends only after all action and template checks pass.
async function collectWorkflowMessages(runLabel) {
  const messages = [];
  const email = {
    enabled: true,
    queue: async (message) => {
      assert.match(message.to, /^delivered\+[a-z0-9-]+@resend\.dev$/);
      if (!CUSTOMER_TEMPLATES.has(message.template)) return 'separate-business-suite';
      messages.push({ ...message });
      return String(messages.length);
    },
  };
  async function action(name, template, perform) {
    const before = messages.length;
    await perform();
    assert.equal(messages.length, before + 1, `${name} should queue exactly one email`);
    assert.equal(messages[before].template, template, `${name} selected the wrong template`);
    messages[before].action = name;
  }

  // Account signup requests verification; using the link queues welcome;
  // asking for a reset queues the reset template.
  {
    const users = new Map();
    const credentials = new Map();
    const tokens = [];
    const models = {
      AuthSession: { create: async (values) => ({ id: `session-${runLabel}`, ...values }) },
      User: {
        create: async (values) => {
          const user = { id: `account-${runLabel}`, isActive: true, emailVerifiedAt: null, ...values,
            update: async function update(changes) { Object.assign(this, changes); } };
          users.set(user.id, user);
          return user;
        },
        findByPk: async (id) => users.get(id) || null,
        findOne: async ({ where }) => [...users.values()].find((user) => user.email === where.email && user.isActive) || null,
      },
      UserCredential: {
        create: async (values) => { credentials.set(values.userId, values); return values; },
        findByPk: async (id) => credentials.get(id) || null,
        update: async (values, { where }) => Object.assign(credentials.get(where.userId), values),
      },
      UserActionToken: {
        count: async () => 0,
        create: async (values) => {
          const row = { id: `token-${tokens.length + 1}-${runLabel}`, ...values, consumedAt: null,
            update: async function update(changes) { Object.assign(this, changes); } };
          tokens.push(row);
          return row;
        },
        findOne: async ({ where }) => tokens.find((row) => row.tokenHash === where.tokenHash && row.purpose === where.purpose) || null,
      },
      AuditLog: { create: async () => ({}) },
      OrganizationOwner: { findAll: async () => [] },
      OrganizationEmployee: { count: async () => 0 },
      OrgAffiliate: { count: async () => 0 },
      EventAffiliate: { count: async () => 0 },
      Event: { count: async () => 0 },
    };
    const auth = createAuthService({ sequelize, models, email, tokenSecret: 'isolated-email-workflow-secret-at-least-32-chars', customerAppUrl: APP_URL });
    const address = recipient('account', runLabel);
    await action('account signup → verify email', TEMPLATES.verifyEmail, () => auth.register({
      email: address, displayName: 'Nitewide Test', password: 'WorkflowTest123!', phone: null,
    }));
    const verifyToken = new URL(messages.at(-1).variables.VERIFY_URL).searchParams.get('verifyEmail');
    await action('email verification → welcome', TEMPLATES.welcome, () => auth.verifyEmail(verifyToken));
    await action('password-reset request', TEMPLATES.passwordReset, () => auth.requestPasswordReset(address));
  }

  // Successful demo checkout exercises the production checkout service's
  // purchase receipt trigger, without invoking Stripe or recording a payment.
  {
    const buyer = { id: `purchase-user-${runLabel}`, email: recipient('purchase', runLabel), displayName: 'Nitewide Test' };
    const event = { id: `purchase-event-${runLabel}`, title: 'Delivery Test Event', status: 'published', organizationId: null,
      startsAt: future(48), endsAt: future(52) };
    const offering = { id: `offering-${runLabel}`, name: 'Test ticket', kind: 'ticket', priceCents: 2500,
      currency: 'USD', inventoryMode: 'finite', quantityTotal: 10, quantitySold: 0, entriesPerUnit: 1,
      minPerOrder: 1, maxPerOrder: 4, isActive: true,
      increment: async function increment(_field, { by }) { this.quantitySold += by; } };
    const models = {
      Order: { findOne: async () => null, create: async (values) => ({ id: `purchase-order-${runLabel}`, ...values }) },
      Event: { findByPk: async () => event },
      Offering: { findAll: async () => [offering] },
      OrderItem: { create: async (values) => ({ id: `item-${runLabel}`, ...values }) },
      Ticket: { create: async () => ({ id: `ticket-${runLabel}` }) },
      Payment: { create: async () => ({}) },
      AffiliateAttribution: { create: async () => ({}) },
      AuditLog: { create: async () => ({}) },
      User: { findByPk: async () => buyer },
    };
    const checkout = createCheckoutService({ sequelize, models, email, customerAppUrl: APP_URL, environment: 'development' });
    await action('successful ticket checkout', TEMPLATES.purchaseReceipt, () => checkout({
      buyerUserId: buyer.id, eventId: event.id, idempotencyKey: `workflow-${runLabel}`,
      items: [{ offeringId: offering.id, quantity: 1 }], payment: { provider: 'demo', status: 'succeeded' },
    }));
  }

  // One request moves pending → declined → approved. Reapproval of a declined
  // request is an existing product capability, so each action sends once.
  {
    const guest = { id: `guest-${runLabel}`, email: recipient('guestlist', runLabel), displayName: 'Nitewide Test', isActive: true };
    const event = { id: `guest-event-${runLabel}`, title: 'Delivery Test Event', status: 'published', organizationId: null,
      startsAt: future(48), endsAt: future(52), guestlistCapacity: 10 };
    let entry;
    const models = {
      Event: { findByPk: async () => event },
      User: { findByPk: async () => guest },
      EventAffiliate: {}, OrgAffiliate: {},
      GuestlistEntry: {
        create: async (values) => {
          entry = { id: `guest-entry-${runLabel}`, ...values,
            update: async function update(changes) { Object.assign(this, changes); } };
          return entry;
        },
        findOne: async () => entry,
        sum: async () => 0,
      },
      AffiliateAttribution: { create: async () => ({}) },
      AuditLog: { create: async () => ({}) },
    };
    const guestlist = createGuestlistService({ sequelize, models, email, customerAppUrl: APP_URL,
      permissions: { guestlistReviewScope: async () => ({ canReviewAny: true, eventAffiliateIds: [] }) } });
    await action('guestlist request', TEMPLATES.guestlistReceived, () => guestlist.request({ eventId: event.id, userId: guest.id, partySize: 2 }));
    await action('guestlist decline', TEMPLATES.guestlistDeclined, () => guestlist.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager', decision: 'reject' }));
    await action('guestlist approval after decline', TEMPLATES.guestlistApproved, () => guestlist.review({ eventId: event.id, entryId: entry.id, reviewedByUserId: 'manager', decision: 'approve' }));
  }

  function eventFixture(kind) {
    const buyer = { id: `event-user-${kind}-${runLabel}`, email: recipient(`event-${kind}`, runLabel), displayName: 'Nitewide Test', isActive: true };
    const oldLocation = { id: `old-location-${kind}-${runLabel}`, name: 'Test venue', addressLine1: '100 First St', city: 'Orlando', region: 'FL', timezone: 'America/New_York' };
    const locations = new Map([[oldLocation.id, oldLocation]]);
    const event = { id: `event-${kind}-${runLabel}`, title: 'Delivery Test Event', organizationId: null,
      status: 'published', version: 1, locationId: oldLocation.id, startsAt: future(48), endsAt: future(52),
      toJSON() { return { id: this.id, title: this.title, organizationId: this.organizationId, status: this.status,
        version: this.version, locationId: this.locationId, startsAt: this.startsAt, endsAt: this.endsAt }; },
      async update(values) { Object.assign(this, values); this.version += 1; return this; } };
    const models = {
      Event: { sequelize, findByPk: async () => event },
      Offering: { findAll: async () => [] },
      Location: {
        findByPk: async (id) => locations.get(id) || null,
        create: async (values) => {
          const location = { id: `new-location-${kind}-${runLabel}`, ...values };
          locations.set(location.id, location);
          return location;
        },
      },
      GuestlistEntry: { sum: async () => 0, findAll: async () => [] },
      Order: { findAll: async () => [{ id: `event-order-${kind}-${runLabel}`, buyerUserId: buyer.id }] },
      User: { findAll: async () => [buyer], findByPk: async () => buyer },
      AuditLog: { create: async () => ({ id: `audit-${kind}-${runLabel}` }) },
    };
    const permissions = { assertManageEvent: async () => event };
    const input = { version: 1, organizationId: null, title: event.title, summary: '', description: '', category: 'nightlife',
      startsAt: event.startsAt, endsAt: event.endsAt, status: 'published', isDiscoverable: false,
      guestlistCapacity: 10, capacity: 20, location: { name: oldLocation.name, addressLine1: oldLocation.addressLine1,
        city: oldLocation.city, region: oldLocation.region, postalCode: '32801', countryCode: 'US', timezone: oldLocation.timezone,
        privacy: 'public' }, offerings: [] };
    return { event, models, permissions, input };
  }

  for (const [kind, name, template, mutate] of [
    ['cancelled', 'published event cancellation', TEMPLATES.eventCancelled, (input) => { input.status = 'cancelled'; }],
    ['time', 'significant event time change', TEMPLATES.eventTimeChange, (input) => { input.startsAt = future(49); input.endsAt = future(53); }],
    ['venue', 'event venue change', TEMPLATES.eventVenueChange, (input) => { input.location.addressLine1 = '200 Second St'; }],
  ]) {
    const fixture = eventFixture(kind);
    mutate(fixture.input);
    const business = createBusinessService({ models: fixture.models, permissions: fixture.permissions, email, customerAppUrl: APP_URL });
    await action(name, template, () => business.saveEvent('manager', fixture.event.id, fixture.input));
  }

  {
    const fixture = eventFixture('instructions');
    await action('manager sends attendee instructions', TEMPLATES.eventInstructions, () => sendAttendeeInstructions({
      models: fixture.models, permissions: fixture.permissions, email, customerAppUrl: APP_URL,
      userId: 'manager', eventId: fixture.event.id, instructions: 'Please bring your booking QR code.',
    }));
  }

  assert.equal(messages.length, 11, 'expected exactly eleven implemented workflow messages');
  assert.equal(new Set(messages.map((message) => message.template)).size, 11);
  assert.ok(messages.every((message) => message.template !== TEMPLATES.guestlistWaitlisted));
  return messages;
}

module.exports = { collectWorkflowMessages };
