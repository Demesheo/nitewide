const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentReconciliationLane } = require('../src/background/payment-reconciliation');

test('payment recovery is disabled unless explicitly configured and never dispatches after shutdown', async () => {
  let calls = 0;
  const work = { sweepReservations: async () => { calls++; }, sweepPendingRefunds: async () => { calls++; } };
  const disabled = createPaymentReconciliationLane({ paymentCheckouts: work, refunds: work });
  await disabled.drain(); assert.equal(calls, 0);
  const lane = createPaymentReconciliationLane({ paymentCheckouts: work, refunds: work, enabled: true });
  await lane.drain(); assert.equal(calls, 2);
  await lane.stop(); await lane.drain(); assert.equal(calls, 2);
  assert.equal(lane.intervalMs, 30000);
});
test('payment recovery bounds batch size, does not overlap and waits for in-flight work on shutdown', async () => {
  let release, calls = 0, finished = false;
  const blocker = new Promise(resolve => { release = resolve; });
  const work = async options => { assert.deepEqual(options, { limit: 1 }); calls++; await blocker; };
  const lane = createPaymentReconciliationLane({ paymentCheckouts: { sweepReservations: work }, refunds: { sweepPendingRefunds: work }, enabled: true });
  const first = lane.drain(); assert.equal(lane.drain(), first); assert.equal(calls, 2);
  const stop = lane.stop().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
  release(); await first; await stop; assert.equal(finished, true);
  await lane.drain(); assert.equal(calls, 2);
});
test('a failed reconciliation waits for the other chain and permits a later bounded retry', async () => {
  let release, calls = 0, done = false;
  const blocker = new Promise(resolve => { release = resolve; });
  const lane = createPaymentReconciliationLane({ enabled: true,
    paymentCheckouts: { sweepReservations: async () => { calls++; throw new Error('provider unavailable'); } },
    refunds: { sweepPendingRefunds: async () => { await blocker; done = true; } } });
  const first = assert.rejects(lane.drain(), /provider unavailable/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false);
  release(); await first; await assert.rejects(lane.drain(), /provider unavailable/); assert.equal(calls, 2);
  await lane.stop();
});
test('commission recovery runs one bounded chain after checkout/refund work and stops cleanly', async () => {
  const calls = []; let release;
  const blocker = new Promise(resolve => { release = resolve; });
  const lane = createPaymentReconciliationLane({ enabled: true,
    paymentCheckouts: { sweepReservations: async () => { calls.push('checkout'); await blocker; } },
    refunds: { sweepPendingRefunds: async () => { calls.push('refund'); } },
    commissionPayments: { sweepPendingCommissions: async options => { assert.deepEqual(options, { limit: 1 }); calls.push('commission'); } } });
  const drain = lane.drain(); assert.deepEqual(calls, ['checkout', 'refund']); assert.equal(lane.drain(), drain);
  release(); await drain; assert.deepEqual(calls, ['checkout', 'refund', 'commission']); await lane.stop(); await lane.drain(); assert.equal(calls.length, 3);
});
