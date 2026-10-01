import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCheckoutAttempt, readCheckoutAttempt, clearCheckoutAttempt, submitCheckoutAttempt, checkCheckoutAttempt, resumePaymentCheckout, verifyPaymentCheckout, restoredCheckoutEvent } from '../src/lib/checkout-attempt.js';

const storage = () => {
  const entries = new Map();
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
};
const body = { eventId: 'event', items: [{ offeringId: 'table', quantity: 2 }], affiliateCode: 'host', expectedTotalCents: 5000, payment: { provider: 'demo', reference: 'reference', status: 'succeeded' } };
test('lost response and reload preserve the buyer, cart, attribution and original payment body', async () => {
  const store = storage();
  const attempt = prepareCheckoutAttempt('buyer', body, store, () => 'stable-key');
  let committed = false;
  const request = async (path, options) => {
    if (path.startsWith('/customer/checkout-attempts/')) {
      if (committed) return { orderId: 'exact-order', status: 'paid' };
      throw Object.assign(new Error('Not found'), { status: 404 });
    }
    assert.equal(path, '/orders'); assert.deepEqual(options.body, attempt.body);
    committed = true; throw new Error('Response lost');
  };
  await assert.rejects(submitCheckoutAttempt(attempt, request, 'token'), /Response lost/);
  const restored = prepareCheckoutAttempt('buyer', { ...body, payment: { ...body.payment, reference: 'new-reference' } }, store, () => assert.fail('must reuse key'));
  assert.deepEqual(restored, attempt);
  assert.equal(await submitCheckoutAttempt(restored, request, 'token'), 'exact-order');
  assert.equal(readCheckoutAttempt('other-buyer', store), null);
  clearCheckoutAttempt('buyer', 'wrong-key', store); assert.ok(readCheckoutAttempt('buyer', store));
  clearCheckoutAttempt('buyer', 'stable-key', store); assert.equal(readCheckoutAttempt('buyer', store), null);
});
test('unresolved cart and referrer changes require recovery before creating another attempt', () => {
  const store = storage(); prepareCheckoutAttempt('buyer', body, store, () => 'key');
  for (const changed of [{ ...body, affiliateCode: 'other' }, { ...body, items: [{ offeringId: 'table', quantity: 1 }] }, { ...body, expectedTotalCents: 6000 }]) {
    assert.throws(() => prepareCheckoutAttempt('buyer', changed, store), /previous booking/);
  }
});
test('status failures and pending responses never submit a second order', async () => {
  const attempt = { body: { idempotencyKey: 'key' } };
  for (const failure of [new Error('Offline'), Object.assign(new Error('Unavailable'), { status: 503 })]) {
    await assert.rejects(submitCheckoutAttempt(attempt, async path => { assert.match(path, /checkout-attempts/); throw failure; }, 'token'), error => error === failure);
  }
  await assert.rejects(checkCheckoutAttempt(attempt, async () => ({ status: 'pending' }), 'token'), /still being checked/);
});
test('unavailable persistence prevents submission', () => {
  assert.throws(() => prepareCheckoutAttempt('buyer', body, { getItem: () => null, setItem: () => { throw new Error('Storage disabled'); } }, () => 'key'), /Storage disabled/);
});
test('blocked browser storage getter tolerates recovery reads and cleanup but prevents preparing a purchase', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.equal(readCheckoutAttempt('buyer'), null);
    assert.doesNotThrow(() => clearCheckoutAttempt('buyer', 'key'));
    assert.throws(() => prepareCheckoutAttempt('buyer', body, undefined, () => assert.fail('must fail before generating or sending an attempt')), /Enable browser storage/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
test('denied storage reads prevent replacing an unreadable pending attempt', () => {
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { assert.fail('must not overwrite an unreadable attempt'); } };
  assert.equal(readCheckoutAttempt('buyer', denied), null);
  assert.throws(() => prepareCheckoutAttempt('buyer', body, denied), /Enable browser storage/);
});
test('denied cleanup remains safe after a purchase has completed', () => {
  const store = storage();
  prepareCheckoutAttempt('buyer', body, store, () => 'key');
  store.removeItem = () => { throw new Error('Denied'); };
  assert.doesNotThrow(() => clearCheckoutAttempt('buyer', 'key', store));
});
test('corrupt saved attempts are not restored', () => {
  const store = storage();
  for (const value of ['broken json', JSON.stringify({ buyerId: 'buyer', body: { idempotencyKey: 'key' } }), JSON.stringify({ buyerId: 'buyer', body: { ...body, items: [{ offeringId: 'table', quantity: -1 }], idempotencyKey: 'key' } })]) {
    store.setItem('nitewide.checkout.buyer', value);
    assert.equal(readCheckoutAttempt('buyer', store), null);
  }
});
test('cancelled and refunded attempts never open admission or submit again', async () => {
  for (const status of ['refunded', 'cancelled']) {
    await assert.rejects(submitCheckoutAttempt({ body: { idempotencyKey: 'key' } }, async path => {
      assert.match(path, /checkout-attempts/); return { orderId: 'order', status };
    }), error => error.terminalOrderId === 'order');
  }
});
test('only definitive POST rollback errors allow retiring the attempt', async () => {
  const attempt = { body: { idempotencyKey: 'key' } };
  for (const code of ['PRICE_CHANGED', 'INSUFFICIENT_INVENTORY', 'INVALID_AFFILIATE', 'PAYMENTS_NOT_ENABLED', 'UNEXPECTED_ERROR']) {
    await assert.rejects(submitCheckoutAttempt(attempt, async path => {
      if (path.startsWith('/customer/')) throw Object.assign(new Error('Absent'), { status: 404 });
      throw Object.assign(new Error('Rejected'), { code });
    }), error => error.checkoutRejected === (code !== 'UNEXPECTED_ERROR'));
  }
});
test('Stripe pending recovery replays the same cart and never stores provider secrets', async () => {
  const store = storage();
  const attempt = prepareCheckoutAttempt('buyer', body, store, () => 'key', 'stripe');
  const checkout = await resumePaymentCheckout(attempt, async (path, options) => {
    if (path.startsWith('/customer/checkout-attempts/')) return { status: 'pending', orderId: 'order' };
    assert.equal(path, '/customer/payment-checkouts');
    assert.equal(options.body.idempotencyKey, 'key');
    assert.equal(options.body.payment, undefined);
    return { status: 'pending', orderId: 'order', clientSecret: 'fixture-only-secret' };
  }, 'token');
  assert.equal(checkout.orderId, 'order');
  assert.equal(JSON.stringify(readCheckoutAttempt('buyer', store)).includes('fixture-only-secret'), false);
});
test('Stripe verification is bounded and server status alone authorizes purchased passes', async () => {
  let checks = 0;
  await assert.rejects(verifyPaymentCheckout('order', async path => { assert.equal(path, '/customer/payment-checkouts/order/verify'); checks += 1; return { orderId: 'order', status: 'pending' }; }, 'token', { tries: 3, delay: async () => {} }), /still being checked/);
  assert.equal(checks, 3);
  assert.deepEqual(await verifyPaymentCheckout('order', async () => ({ orderId: 'order', status: 'paid' }), 'token'), { orderId: 'order', status: 'paid' });
});
test('provider review state suppresses payment remount and additional verification polling', async () => {
  const attempt = { body: { idempotencyKey: 'key' } };
  const result = await resumePaymentCheckout(attempt, async path => {
    assert.match(path, /checkout-attempts/);
    return { orderId: 'order', status: 'pending', verificationStatus: 'review' };
  });
  assert.equal(result.clientSecret, null);
  assert.equal(result.verificationStatus, 'review');
  let checks = 0;
  await assert.rejects(verifyPaymentCheckout('order', async () => { checks += 1; return result; }, 'token', { delay: () => assert.fail('must not retry a reviewed payment') }), error => error.paymentReview && error.orderId === 'order');
  assert.equal(checks, 1);
});
test('pending booking context survives an unavailable public event and excludes provider secrets', () => {
  const event = { id: 'event', title: 'Your night', startsAt: '2026-10-30T23:00:00Z', clientSecret: 'never-store', location: { city: 'Orlando' }, offerings: [{ id: 'table', name: 'Table', priceCents: 2500, currency: 'USD', clientSecret: 'never-store' }] };
  const attempt = prepareCheckoutAttempt('buyer', body, storage(), () => 'key', 'stripe', 'Your host', event);
  assert.equal(restoredCheckoutEvent(attempt).title, 'Your night');
  assert.equal(JSON.stringify(attempt).includes('never-store'), false);
  assert.equal(restoredCheckoutEvent({ ...attempt, eventContext: { ...attempt.eventContext, title: {} } }), null);
});
