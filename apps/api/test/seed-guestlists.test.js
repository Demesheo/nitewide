const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtureEmail, planGuestlistFixtures, futureStatuses, pastStatuses, staffReferralRoles } = require('../src/db/seed-guestlists');

test('every future demo event has each applicable status and never a check-in or no-show', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const events = [
    { id: 'future-a', organizationId: 'venue-a', startsAt: '2026-09-25T22:00:00Z', endsAt: '2026-09-26T02:00:00Z' },
    { id: 'future-b', organizationId: 'venue-b', startsAt: '2026-09-26T22:00:00Z', endsAt: '2026-09-27T02:00:00Z' },
  ];
  const plan = planGuestlistFixtures(events, now);
  for (const event of events) {
    const entries = plan.filter((item) => item.event.id === event.id);
    assert.deepEqual(entries.map((item) => item.status), [...futureStatuses, 'pending', 'pending']);
    assert.deepEqual(entries.filter((item) => item.referrerRole).map((item) => item.referrerRole), ['promoter', staffReferralRoles[events.indexOf(event)]]);
  }
  assert.ok(plan.every((item) => !['checked_in', 'no_show'].includes(item.status)));
  assert.equal(new Set(plan.filter((item) => item.event.id === 'future-a').map((item) => item.userIndex)).size, futureStatuses.length + 2);
});

test('only the two most recent completed events per venue receive past-state fixtures', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const past = (id, organizationId, day) => ({ id, organizationId, startsAt: `2026-09-${day}T20:00:00Z`, endsAt: `2026-09-${day}T23:00:00Z` });
  const plan = planGuestlistFixtures([past('old', 'a', '17'), past('recent', 'a', '20'), past('middle', 'a', '19'), past('other', 'b', '18')], now);
  assert.deepEqual([...new Set(plan.map((item) => item.event.id))], ['recent', 'middle', 'other']);
  for (const id of ['recent', 'middle', 'other']) {
    const entries = plan.filter((item) => item.event.id === id);
    assert.deepEqual(entries.map((item) => item.status), [...pastStatuses, 'no_show', 'no_show']);
    assert.equal(entries.filter((item) => item.referrerRole).length, 2);
  }
  assert.ok(plan.every((item) => item.status === 'checked_in' || item.status === 'no_show'));
});

test('guestlist-only demo customers have a distinct email namespace from sales buyers', () => {
  assert.equal(fixtureEmail(0), 'guestlist.demo01@nitewide.test');
  assert.equal(fixtureEmail(11), 'guestlist.demo12@nitewide.test');
  assert.ok(!fixtureEmail(0).includes('.customer'));
});

test('referral fixtures cover every team role and favor employees and promoters', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const events = Array.from({ length: 12 }, (_, index) => ({ id: `future-${index}`, organizationId: 'venue-a',
    startsAt: new Date(now.getTime() + (index + 1) * 86400000), endsAt: new Date(now.getTime() + (index + 1) * 86400000 + 14400000) }));
  const roles = planGuestlistFixtures(events, now).map((item) => item.referrerRole).filter(Boolean);
  assert.deepEqual([...new Set(roles)].sort(), ['employee', 'manager', 'owner', 'promoter']);
  assert.ok(roles.filter((role) => role === 'employee' || role === 'promoter').length > roles.length * 0.75);
});
