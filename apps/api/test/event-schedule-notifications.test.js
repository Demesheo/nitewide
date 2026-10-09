const test = require('node:test');
const assert = require('node:assert/strict');
const { recordEventMutation } = require('../src/services/event-mutation-policy');
const { TEMPLATES } = require('../src/services/email-templates');

function fixture(enabled) {
  const transaction = {};
  const notices = []; const emails = []; const reads = [];
  const users = [
    { id: 'buyer', email: 'buyer@example.test', displayName: 'Buyer' },
    { id: 'guest', email: 'guest@example.test', displayName: 'Guest' },
    { id: 'no-email', email: null, displayName: 'Guest without email' },
  ];
  const models = {
    AuditLog: { create: async (_values, options) => assert.equal(options.transaction, transaction) },
    Order: { findAll: async options => {
      assert.equal(options.transaction, transaction); assert.deepEqual(options.where, { eventId: 'event', status: 'paid' });
      reads.push('orders');
      return [{ id: 'order-1', buyerUserId: 'buyer' }, { id: 'order-2', buyerUserId: 'buyer' }];
    } },
    GuestlistEntry: { findAll: async options => {
      assert.equal(options.transaction, transaction);
      assert.deepEqual(options.where, { eventId: 'event', status: ['pending', 'confirmed', 'checked_in'] });
      reads.push('guests');
      return [{ id: 'buyer-entry', userId: 'buyer' }, { id: 'guest-entry', userId: 'guest' },
        { id: 'no-email-entry', userId: 'no-email' }, { id: 'anonymous-entry', userId: null }];
    } },
    User: { findAll: async options => {
      assert.equal(options.transaction, transaction);
      assert.deepEqual(options.where, { id: ['buyer', 'guest', 'no-email'], isActive: true });
      reads.push('users'); return users;
    } },
    Notification: { create: async (values, options) => {
      assert.equal(options.transaction, transaction); notices.push(values); return values;
    } },
  };
  const email = { enabled, queue: async (values, tx) => { assert.equal(tx, transaction); emails.push(values); } };
  const before = { status: 'published', startsAt: '2026-10-11T01:00:00Z', endsAt: '2026-10-11T06:00:00Z' };
  const saved = { id: 'event', title: 'Culture Code Friday', status: 'published', version: 2,
    startsAt: '2026-10-10T01:00:00Z', endsAt: '2026-10-10T06:00:00Z', toJSON() { return { ...this }; } };
  const location = { name: 'Venue', timezone: 'America/New_York' };
  const input = { models, email, before, saved, transaction, location, previousLocation: location,
    userId: 'manager', customerAppUrl: 'https://customer.test/', businessAppUrl: 'https://business.test/', paymentValidated: true };
  return { input, notices, emails, reads };
}

test('schedule changes persist one inbox update per attendee even without email; enabled email uses the same audience and times', async () => {
  for (const enabled of [false, true]) {
    const { input, notices, emails, reads } = fixture(enabled);
    await recordEventMutation(input);
    assert.deepEqual(reads, ['orders', 'guests', 'users'], 'resolve the deduplicated audience once for both channels');
    assert.deepEqual(notices.map(row => row.userId), ['buyer', 'guest', 'no-email']);
    for (const notice of notices) {
      assert.equal(notice.eventId, 'event'); assert.equal(notice.kind, 'event_time_changed');
      assert.equal(notice.title, 'Event schedule changed'); assert.equal(notice.metadata.eventVersion, 2);
      assert.match(notice.metadata.oldTime, /Saturday, October 10, 2026 at 9:00 PM/);
      assert.match(notice.metadata.newTime, /Friday, October 9, 2026 at 9:00 PM/);
      assert.match(notice.message, /Culture Code Friday.*changed from.*to.*review your plans/);
      assert.ok(notice.message.length <= 500);
    }
    assert.equal(emails.length, enabled ? 2 : 0);
    for (const message of emails) {
      assert.equal(message.template, TEMPLATES.eventTimeChange);
      assert.equal(message.variables.OLD_TIME, notices[0].metadata.oldTime);
      assert.equal(message.variables.NEW_TIME, notices[0].metadata.newTime);
      assert.match(message.key, /^event\/event\/time-2\//);
    }
    if (enabled) assert.equal(new URL(emails[0].variables.BOOKING_URL).searchParams.get('booking'), 'purchase:order-1');
  }
});

test('schedule guards retain the existing email threshold and skip drafts, unchanged times and unrelated edits', async () => {
  for (const [beforeStatus, savedStatus, shift] of [
    ['draft', 'draft', -86400000], ['draft', 'published', -86400000],
    ['published', 'published', 0], ['published', 'published', 14 * 60000],
  ]) {
    const { input, notices, emails, reads } = fixture(false);
    input.before.status = beforeStatus; input.saved.status = savedStatus;
    input.saved.startsAt = new Date(Date.parse(input.before.startsAt) + shift);
    input.saved.endsAt = new Date(Date.parse(input.before.endsAt) + shift);
    await recordEventMutation(input);
    assert.deepEqual(notices, []); assert.deepEqual(emails, []); assert.deepEqual(reads, []);
  }
  const { input, notices } = fixture(false);
  input.saved.startsAt = input.before.startsAt;
  input.saved.endsAt = new Date(Date.parse(input.before.endsAt) + 15 * 60000);
  await recordEventMutation(input);
  assert.equal(notices.length, 3, 'an end-time-only change at the threshold also notifies');
});

test('inbox persistence failures reject the event mutation before email is queued', async () => {
  const { input, emails } = fixture(true);
  input.models.Notification.create = async () => { throw new Error('Inbox write failed'); };
  await assert.rejects(recordEventMutation(input), /Inbox write failed/);
  assert.deepEqual(emails, []);
});
