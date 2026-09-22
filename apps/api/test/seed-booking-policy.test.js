const test = require('node:test');
const assert = require('node:assert/strict');
const { overlaps, canBook, planPurchaseCleanup } = require('../src/db/seed-booking-policy');
const event = (id, start = '2026-09-25T22:00:00-04:00', end = '2026-09-26T02:00:00-04:00') => ({ id, startsAt: start, endsAt: end });
test('purchase intervals handle midnight and adjacent non-overlapping events', () => {
  assert.equal(overlaps(event('a'), event('b')), true);
  assert.equal(overlaps(event('a'), event('b','2026-09-26T02:00:00-04:00','2026-09-26T03:00:00-04:00')), false);
  assert.equal(canBook([event('a')], event('a')), true, 'Additional tickets for the same event are one booking');
  assert.equal(canBook([event('a')], event('b')), false);
});
test('cleanup keeps earliest purchase, never removes non-seed orders and never considers guestlists', () => {
  const order = (id, eventId, extra = {}) => ({ id, event: event(eventId), buyerUserId: 'buyer', paidAt: `2026-09-20T0${id}:00:00Z`, seed: true, ...extra });
  const plan = planPurchaseCleanup([order('3','b'), order('1','a'), order('2','a'), order('4','b',{buyerUserId:'other'})]);
  assert.deepEqual(plan.kept.map(o => o.id), ['1','2','4']);
  assert.deepEqual(plan.removed.map(o => o.order.id), ['3']);
  assert.equal(plan.removed[0].keptOrderId, '1');
  const protectedPlan = planPurchaseCleanup([order('1','a'), order('2','b',{seed:false})]);
  assert.deepEqual(protectedPlan.removed.map(o => o.order.id), ['1']);
});
