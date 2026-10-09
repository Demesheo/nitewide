const test = require('node:test');
const assert = require('node:assert/strict');
const { createStripeRefundService } = require('../src/services/stripe-refund-service');

test('refund sweep bounds work, isolates failures and never exposes provider errors', async () => {
  let query, calls = 0;
  const rows = ['one', 'two'].map(id => ({ id, orderId: `order-${id}`, status: 'pending', stripeAccountId: 'acct_test', paymentAccountId: 'profile', amountCents: 100, currency: 'USD', approvedByUserId: 'merchant', createdAt: new Date() }));
  const models = {
    Refund: { findAll: async options => { query = options; return rows; }, update: async () => {} },
    Order: { findByPk: async id => ({ id, providerMode: 'test', stripeAccountId: 'acct_test', paymentAccountId: 'profile', totalCents: 100, currency: 'USD', status: 'paid', stripePaymentIntentId: 'pi_test', stripeChargeId: 'ch_test' }) },
  };
  const service = createStripeRefundService({ models, stripe: { enabled: true, mode: 'test', createRefund: async (params, options) => {
    calls++; assert.equal(options.idempotencyKey, `refund/${params.metadata.refundId}`);
    assert.equal(params.amount, 100); assert.equal(params.refund_application_fee, true);
    throw Object.assign(new Error('secret provider details'), { code: 'sk_secret' });
  } } });
  const results = await service.sweepPendingRefunds({ limit: 10000 });
  assert.equal(query.limit, 25); assert.equal(calls, 2);
  assert.deepEqual(results, rows.map(row => ({ refundId: row.id, orderId: row.orderId, status: 'pending', retryable: true })));
  models.Order.findByPk = async () => null;
  const invalid = await service.sweepPendingRefunds({ limit: -1 });
  assert.equal(query.limit, 25); assert.equal(calls, 2);
  assert.equal(invalid[0].code, 'REFUND_STATE_CONFLICT');
  assert.equal(JSON.stringify(invalid).includes('secret'), false);
});

test('aged lost refund creation is held for review without a provider replay', async () => {
  const refund = { id: 'refund', orderId: 'order', status: 'pending', stripeAccountId: 'acct_test', paymentAccountId: 'profile', amountCents: 100, currency: 'USD', approvedByUserId: 'merchant', createdAt: new Date(0) };
  const models = { Order: { findByPk: async () => ({ id: 'order', status: 'paid', providerMode: 'test', stripeAccountId: 'acct_test', paymentAccountId: 'profile', totalCents: 100, currency: 'USD', stripePaymentIntentId: 'pi_test', stripeChargeId: 'ch_test' }) } };
  const service = createStripeRefundService({ models, stripe: { enabled: true, mode: 'test', createRefund: async () => assert.fail('Aged approval must not create money movement') } });
  await assert.rejects(service.reconcile(refund), { code: 'REFUND_STATE_CONFLICT' });
});

function terminalRecoveryFixture(change = () => {}) {
  const order = { id: 'order', eventId: 'event', status: 'refunded', providerMode: 'test',
    stripeAccountId: 'acct_test', paymentAccountId: 'profile', totalCents: 1164, applicationFeeCents: 100,
    currency: 'USD', stripePaymentIntentId: 'pi_test', stripeChargeId: 'ch_test',
    providerVerificationStatus: 'verified', reservationReleasedAt: new Date('2026-10-07T21:51:36Z') };
  const refund = { id: 'refund', orderId: order.id, status: 'pending', stripeAccountId: order.stripeAccountId,
    paymentAccountId: order.paymentAccountId, amountCents: order.totalCents, currency: 'USD',
    providerReference: 're_test', approvedByUserId: 'merchant', requestedByUserId: 'merchant',
    reason: 'Approved test refund', createdAt: new Date(0) };
  const evidence = { id: 're_test', status: 'succeeded', amount: 1164, currency: 'usd',
    payment_intent: 'pi_test', charge: 'ch_test', metadata: { refundId: 'refund', orderId: 'order' } };
  const charge = { id: 'ch_test', livemode: false, payment_intent: 'pi_test', amount: 1164,
    currency: 'usd', paid: true, captured: true, refunded: true, amount_refunded: 1164,
    application_fee: 'fee_test', application_fee_amount: 100 };
  const fee = { id: 'fee_test', livemode: false, amount: 100, currency: 'usd', refunded: true,
    amount_refunded: 100, account: 'acct_test', charge: 'ch_test' };
  const lockedOrder = { ...order };
  const lockedRefund = { ...refund };
  const state = { order, refund, evidence, charge, fee, lockedOrder, lockedRefund };
  change(state);
  const calls = { provider: [], mutations: [], audits: [] };
  const forbidden = operation => async () => assert.fail(`Terminal recovery must not ${operation}`);
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  lockedOrder.update = forbidden('update the already-refunded order');
  lockedRefund.update = async (values, options) => {
    assert.equal(options.transaction, transaction);
    assert.deepEqual(values, { status: 'succeeded' });
    calls.mutations.push(values);
    Object.assign(lockedRefund, values);
  };
  const models = {
    Order: { findByPk: async (id, options) => {
      assert.equal(id, 'order');
      if (options) { assert.equal(options.transaction, transaction); assert.equal(options.lock, 'UPDATE'); }
      return options ? lockedOrder : order;
    } },
    Event: { findByPk: async (id, options) => {
      assert.equal(id, 'event'); assert.equal(options.transaction, transaction); assert.equal(options.lock, 'UPDATE');
      return { id: 'event', organizationId: 'organization' };
    } },
    Refund: { findByPk: async (id, options) => {
      assert.equal(id, 'refund'); assert.equal(options.transaction, transaction); assert.equal(options.lock, 'UPDATE');
      return lockedRefund;
    } },
    OrderItem: { findAll: forbidden('read/reapply order-item adjustments') },
    Offering: { findAll: forbidden('release inventory again') },
    Ticket: { update: forbidden('void tickets again') },
    Payment: { update: forbidden('refund payment records again') },
    OrderRefundRequest: { update: forbidden('resolve requests again') },
    CommissionEarning: { findAll: forbidden('adjust commission earnings again') },
    AuditLog: { create: async (values, options) => {
      assert.equal(options.transaction, transaction); calls.audits.push(values);
    } },
  };
  const stripe = { enabled: true, mode: 'test', createRefund: forbidden('create another provider refund'),
    retrieveRefund: async (id, options) => {
      assert.equal(id, 're_test'); assert.deepEqual(options, { stripeAccount: 'acct_test' });
      calls.provider.push('refund'); return evidence;
    },
    retrieveCharge: async (id, options) => {
      assert.equal(id, 'ch_test'); assert.deepEqual(options, { stripeAccount: 'acct_test' });
      calls.provider.push('charge'); return charge;
    },
    retrieveApplicationFee: async (id, options) => {
      assert.equal(id, 'fee_test'); assert.deepEqual(options, {});
      calls.provider.push('fee'); return fee;
    },
  };
  const service = createStripeRefundService({ models, stripe,
    sequelize: { transaction: async (options, work) => work(transaction) } });
  return { ...state, service, calls, stripe };
}

test('verified bound terminal refund recovery finalizes only its local approval and is replay-safe', async () => {
  const { service, refund, lockedRefund, calls } = terminalRecoveryFixture();
  const result = await service.reconcile(refund);
  assert.deepEqual(result, { refundId: 'refund', orderId: 'order', status: 'succeeded' });
  assert.deepEqual(calls.provider, ['refund', 'charge', 'fee']);
  assert.deepEqual(calls.mutations, [{ status: 'succeeded' }]);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, 'order.refunded');
  assert.equal(calls.audits[0].actorUserId, 'merchant');
  assert.equal(calls.audits[0].entityId, 'order');
  assert.equal(calls.audits[0].after.refundId, 'refund');
  assert.equal(calls.audits[0].after.applicationFeeRefunded, true);
  assert.equal(calls.audits[0].after.recoveredPreviouslyRefunded, true);
  // Both a stale sweep row and an already-finalized instance are harmless.
  assert.deepEqual(await service.reconcile(refund), result);
  assert.deepEqual(await service.reconcile(lockedRefund), result);
  assert.equal(calls.mutations.length, 1);
  assert.equal(calls.audits.length, 1);
  const raced = terminalRecoveryFixture(({ order }) => { order.status = 'paid'; });
  assert.deepEqual(await raced.service.reconcile(raced.refund), result);
  assert.equal(raced.calls.audits[0].after.recoveredPreviouslyRefunded, true);
  assert.deepEqual(raced.calls.mutations, [{ status: 'succeeded' }]);
});

test('terminal refund recovery rejects mismatched approval bindings and unverified provider evidence', async t => {
  const cases = [
    ['missing provider reference', ({ refund }) => { refund.providerReference = null; refund.createdAt = new Date(); }, 'REFUND_STATE_CONFLICT'],
    ['unapproved refund', ({ refund }) => { refund.approvedByUserId = null; }, 'REFUND_STATE_CONFLICT'],
    ['wrong approved account', ({ refund }) => { refund.stripeAccountId = 'acct_other'; }, 'REFUND_STATE_CONFLICT'],
    ['wrong approved payment profile', ({ refund }) => { refund.paymentAccountId = 'other-profile'; }, 'REFUND_STATE_CONFLICT'],
    ['wrong approved amount', ({ refund }) => { refund.amountCents = 1163; }, 'REFUND_STATE_CONFLICT'],
    ['wrong approved currency', ({ refund }) => { refund.currency = 'EUR'; }, 'REFUND_STATE_CONFLICT'],
    ['wrong retrieved order', ({ order }) => { order.id = 'other-order'; }, 'REFUND_STATE_CONFLICT'],
    ['live order', ({ order }) => { order.providerMode = 'live'; }, 'REFUND_STATE_CONFLICT'],
    ['wrong retrieved refund', ({ evidence }) => { evidence.id = 're_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong refund order metadata', ({ evidence }) => { evidence.metadata.orderId = 'other-order'; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong approval metadata', ({ evidence }) => { evidence.metadata.refundId = 'other-refund'; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong refund amount', ({ evidence }) => { evidence.amount = 1163; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong refund currency', ({ evidence }) => { evidence.currency = 'eur'; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong refund payment intent', ({ evidence }) => { evidence.payment_intent = 'pi_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong refund charge', ({ evidence }) => { evidence.charge = 'ch_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['live refund', ({ evidence }) => { evidence.livemode = true; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong retrieved charge', ({ charge }) => { charge.id = 'ch_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['live charge', ({ charge }) => { charge.livemode = true; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong charge payment intent', ({ charge }) => { charge.payment_intent = 'pi_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong charge amount', ({ charge }) => { charge.amount = 1163; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong charge currency', ({ charge }) => { charge.currency = 'eur'; }, 'REFUND_VERIFICATION_FAILED'],
    ['unpaid charge', ({ charge }) => { charge.paid = false; }, 'REFUND_VERIFICATION_FAILED'],
    ['uncaptured charge', ({ charge }) => { charge.captured = false; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong charge application fee amount', ({ charge }) => { charge.application_fee_amount = 101; }, 'REFUND_VERIFICATION_FAILED'],
    ['partial customer refund', ({ charge }) => { charge.amount_refunded = 1163; }, 'REFUND_VERIFICATION_FAILED'],
    ['charge not refunded', ({ charge }) => { charge.refunded = false; }, 'REFUND_VERIFICATION_FAILED'],
    ['missing application fee', ({ charge }) => { charge.application_fee = null; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong retrieved fee', ({ fee }) => { fee.id = 'fee_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong fee amount', ({ fee }) => { fee.amount = 101; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong fee currency', ({ fee }) => { fee.currency = 'eur'; }, 'REFUND_VERIFICATION_FAILED'],
    ['live fee', ({ fee }) => { fee.livemode = true; }, 'REFUND_VERIFICATION_FAILED'],
    ['fee not refunded', ({ fee }) => { fee.refunded = false; }, 'REFUND_VERIFICATION_FAILED'],
    ['partial fee refund', ({ fee }) => { fee.amount_refunded = 99; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong fee account', ({ fee }) => { fee.account = 'acct_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['wrong fee charge', ({ fee }) => { fee.charge = 'ch_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['locked order account changed', ({ lockedOrder }) => { lockedOrder.stripeAccountId = 'acct_other'; }, 'REFUND_STATE_CONFLICT'],
    ['locked order profile changed', ({ lockedOrder }) => { lockedOrder.paymentAccountId = 'other-profile'; }, 'REFUND_STATE_CONFLICT'],
    ['locked order amount changed', ({ lockedOrder }) => { lockedOrder.totalCents = 1163; }, 'REFUND_STATE_CONFLICT'],
    ['locked order currency changed', ({ lockedOrder }) => { lockedOrder.currency = 'EUR'; }, 'REFUND_STATE_CONFLICT'],
    ['locked order mode changed', ({ lockedOrder }) => { lockedOrder.providerMode = 'live'; }, 'REFUND_STATE_CONFLICT'],
    ['locked order identity changed', ({ lockedOrder }) => { lockedOrder.id = 'other-order'; }, 'REFUND_STATE_CONFLICT'],
    ['locked order event changed', ({ lockedOrder }) => { lockedOrder.eventId = 'other-event'; }, 'REFUND_VERIFICATION_FAILED'],
    ['locked order payment intent changed', ({ lockedOrder }) => { lockedOrder.stripePaymentIntentId = 'pi_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['locked order charge changed', ({ lockedOrder }) => { lockedOrder.stripeChargeId = 'ch_other'; }, 'REFUND_VERIFICATION_FAILED'],
    ['locked order fee changed', ({ lockedOrder }) => { lockedOrder.applicationFeeCents = 101; }, 'REFUND_VERIFICATION_FAILED'],
    ['locked approval order changed', ({ lockedRefund }) => { lockedRefund.orderId = 'other-order'; }, 'REFUND_STATE_CONFLICT'],
    ['locked approval account changed', ({ lockedRefund }) => { lockedRefund.stripeAccountId = 'acct_other'; }, 'REFUND_STATE_CONFLICT'],
    ['locked approval profile changed', ({ lockedRefund }) => { lockedRefund.paymentAccountId = 'other-profile'; }, 'REFUND_STATE_CONFLICT'],
    ['locked approval amount changed', ({ lockedRefund }) => { lockedRefund.amountCents = 1163; }, 'REFUND_STATE_CONFLICT'],
    ['locked approval currency changed', ({ lockedRefund }) => { lockedRefund.currency = 'EUR'; }, 'REFUND_STATE_CONFLICT'],
    ['locked approval withdrawn', ({ lockedRefund }) => { lockedRefund.approvedByUserId = null; }, 'REFUND_STATE_CONFLICT'],
    ['locked approval reference changed', ({ lockedRefund }) => { lockedRefund.providerReference = 're_other'; }, 'REFUND_VERIFICATION_FAILED'],
  ];
  for (const [name, change, code] of cases) await t.test(name, async () => {
    const { service, refund, calls } = terminalRecoveryFixture(change);
    await assert.rejects(service.reconcile(refund), { code });
    assert.deepEqual(calls.mutations, []);
    assert.deepEqual(calls.audits, []);
  });
});

test('terminal refund recovery waits for succeeded evidence and retries provider failures without local writes', async () => {
  const unsettled = terminalRecoveryFixture(({ evidence }) => { evidence.status = 'pending'; });
  assert.deepEqual(await unsettled.service.reconcile(unsettled.refund), {
    refundId: 'refund', orderId: 'order', status: 'pending', retryable: true,
  });
  assert.deepEqual(unsettled.calls.mutations, []);
  assert.deepEqual(unsettled.calls.audits, []);
  const unavailable = terminalRecoveryFixture();
  unavailable.stripe.retrieveRefund = async () => { throw new Error('private provider error'); };
  assert.deepEqual(await unavailable.service.reconcile(unavailable.refund), {
    refundId: 'refund', orderId: 'order', status: 'pending', retryable: true,
  });
  assert.deepEqual(unavailable.calls.mutations, []);
  assert.deepEqual(unavailable.calls.audits, []);
});
test('live refund recovery infers missing refund mode from the original live charge and application fee', async () => {
  const f = terminalRecoveryFixture(({ order, lockedOrder, charge, fee }) => {
    order.providerMode = 'live'; lockedOrder.providerMode = 'live'; charge.livemode = true; fee.livemode = true;
  });
  f.stripe.mode = 'live';
  assert.equal((await f.service.reconcile(f.refund)).status, 'succeeded');
  assert.deepEqual(f.calls.provider, ['refund', 'charge', 'fee']);
  assert.equal(f.calls.mutations.length, 1);
  const wrongRuntime = terminalRecoveryFixture(); wrongRuntime.stripe.mode = 'live';
  await assert.rejects(wrongRuntime.service.reconcile(wrongRuntime.refund), { code: 'REFUND_STATE_CONFLICT' });
  assert.deepEqual(wrongRuntime.calls.provider, []);
});
