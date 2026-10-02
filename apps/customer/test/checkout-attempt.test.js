import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCheckoutAttempt, readCheckoutAttempt, clearCheckoutAttempt, submitCheckoutAttempt, checkCheckoutAttempt, resumePaymentCheckout, checkPaymentCheckout, verifyPaymentCheckout, restoredCheckoutEvent, rememberCheckoutOrder, restorePaymentAttempt } from '../src/lib/checkout-attempt.js';

const storage = () => {
  const entries = new Map();
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
};
const body = { eventId: 'event', items: [{ offeringId: 'table', quantity: 2 }], affiliateCode: 'host', expectedTotalCents: 5000, payment: { provider: 'demo', reference: 'reference', status: 'succeeded' } };
const restored = { orderId: 'original-order', status: 'pending', clientSecret: 'secret-never-persist', stripeAccountId: 'acct_original', booking: {
  idempotencyKey: 'original-key', event: { id: 'event', title: 'Your original night', startsAt: '2026-10-10T21:00:00Z', endsAt: '2026-10-11T03:00:00Z', location: { name: 'Venue' } },
  items: [{ offeringId: 'table', name: 'Original package', kind: 'package', quantity: 2, unitPriceCents: 2000 }], currency: 'USD', subtotalCents: 4000, totalCents: 4500,
} };
test('Booked restores the server-owned cart without browser storage, repricing or retaining provider secrets', async () => {
  const store = storage();
  const attempt = restorePaymentAttempt('buyer', restored, store);
  assert.equal(attempt.orderId, 'original-order');
  assert.equal(attempt.body.idempotencyKey, 'original-key');
  assert.deepEqual(attempt.bookingTotals, { subtotal: 4000, fee: 500, total: 4500 });
  assert.equal(restoredCheckoutEvent(attempt).offerings[0].priceCents, 2000);
  assert.deepEqual(readCheckoutAttempt('buyer', store), attempt);
  assert.equal(JSON.stringify(attempt).includes('secret-never-persist'), false);
  assert.equal(JSON.stringify(attempt).includes('acct_original'), false);
  const calls = [];
  assert.equal((await resumePaymentCheckout(attempt, async (path, options) => { calls.push([path, options]); return restored; }, 'token')).orderId, 'original-order');
  assert.deepEqual(calls, [['/customer/payment-checkouts/original-order/resume', { token: 'token', method: 'POST' }]]);
});
test('resuming another server order never overwrites an unresolved locally saved attempt', () => {
  const store = storage();
  const prior = prepareCheckoutAttempt('buyer', body, store, () => 'other-key', 'stripe');
  const attempt = restorePaymentAttempt('buyer', restored, store);
  assert.equal(attempt.orderId, 'original-order');
  assert.deepEqual(readCheckoutAttempt('buyer', store), prior);
  clearCheckoutAttempt('buyer', attempt.body.idempotencyKey, store);
  assert.deepEqual(readCheckoutAttempt('buyer', store), prior);
});
test('server order recovery still works if persistence is denied; malformed recovery cannot produce a new checkout', () => {
  const denied = { getItem() { throw new Error('Denied'); } };
  assert.equal(restorePaymentAttempt('buyer', restored, denied).orderId, 'original-order');
  assert.throws(() => restorePaymentAttempt('buyer', { orderId: 'missing-cart' }, denied), /could not be restored/);
});
test('recording an existing order preserves the original retry key and never replaces another saved attempt', () => {
  const store = storage();
  const attempt = prepareCheckoutAttempt('buyer', body, store, () => 'stable-key', 'stripe');
  assert.equal(rememberCheckoutOrder(attempt, 'original-order', store).body.idempotencyKey, 'stable-key');
  assert.equal(readCheckoutAttempt('buyer', store).orderId, 'original-order');
  rememberCheckoutOrder({ ...attempt, body: { ...attempt.body, idempotencyKey: 'wrong-key' } }, 'other-order', store);
  assert.equal(readCheckoutAttempt('buyer', store).orderId, 'original-order');
});
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
test('all Stripe recovery paths reject server-confirmed cancelled and refunded orders without replaying them', async () => {
  for (const status of ['cancelled', 'refunded']) {
    for (const path of ['resume', 'lookup', 'prepare']) {
      const attempt = { body: { idempotencyKey: 'original-key' }, ...(path === 'resume' ? { orderId: 'ended-order' } : {}) };
      const calls = [];
      await assert.rejects(resumePaymentCheckout(attempt, async url => {
        calls.push(url);
        if (path === 'prepare' && url.startsWith('/customer/checkout-attempts/')) throw Object.assign(new Error('Absent'), { status: 404 });
        return { orderId: 'ended-order', status, clientSecret: 'must-not-mount' };
      }, 'token'), error => error.terminalOrderId === 'ended-order' && /checkout has ended/.test(error.message));
      assert.deepEqual(calls, path === 'resume' ? ['/customer/payment-checkouts/ended-order/resume'] : path === 'lookup' ? ['/customer/checkout-attempts/original-key'] : ['/customer/checkout-attempts/original-key', '/customer/payment-checkouts']);
    }
  }
});
test('known-order recovery preserves unknown outcomes and suppresses reviewed payment secrets', async () => {
  const attempt = { orderId: 'original-order', body: { idempotencyKey: 'original-key' } };
  const review = await resumePaymentCheckout(attempt, async () => ({ ...restored, verificationStatus: 'review' }), 'token');
  assert.equal(review.clientSecret, null);
  for (const failure of [new Error('Offline'), Object.assign(new Error('Not found'), { status: 404 })]) {
    await assert.rejects(resumePaymentCheckout(attempt, async () => { throw failure; }, 'token'), error => error === failure && !error.terminalOrderId);
  }
});
test('Stripe verification is bounded and server status alone authorizes purchased passes', async () => {
  let checks = 0;
  await assert.rejects(verifyPaymentCheckout('order', async path => { assert.equal(path, '/customer/payment-checkouts/order/verify'); checks += 1; return { orderId: 'order', status: 'pending' }; }, 'token', { tries: 3, delay: async () => {} }), /still being checked/);
  assert.equal(checks, 3);
  assert.deepEqual(await verifyPaymentCheckout('order', async () => ({ orderId: 'order', status: 'paid' }), 'token'), { orderId: 'order', status: 'paid' });
});
test('Pay preflight permits only a matching server-verified pending or paid booking', async () => {
  for (const status of ['pending', 'paid']) {
    const result = {orderId:'original-order',status};
    assert.deepEqual(await checkPaymentCheckout('original-order', async (path, options) => {
      assert.equal(path, '/customer/payment-checkouts/original-order/verify');
      assert.deepEqual(options, {token:'token',method:'POST'});
      return result;
    }, 'token'), result);
  }
  for (const result of [null, {orderId:'original-order',status:'unknown'}, {orderId:'other-order',status:'paid'}, {orderId:'other-order',status:'cancelled'}, {orderId:'other-order',status:'pending',verificationStatus:'review'}]) {
    await assert.rejects(checkPaymentCheckout('original-order', async () => result, 'token'), /couldn’t check this booking/);
  }
  for (const status of ['cancelled', 'refunded']) {
    await assert.rejects(checkPaymentCheckout('original-order', async () => ({orderId:'original-order',status}), 'token'), error => error.terminalOrderId === 'original-order');
  }
  const offline = new Error('Offline');
  await assert.rejects(checkPaymentCheckout('original-order', async () => {throw offline;}, 'token'), error => error === offline);
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
