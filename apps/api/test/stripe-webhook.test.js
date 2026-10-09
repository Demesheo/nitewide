const test = require('node:test');
const assert = require('node:assert/strict');
const { createStripeWebhookService } = require('../src/services/stripe-webhook-service');
function fixture(event, { account = null, mode = 'test' } = {}) {
  let reads = 0, writes = 0, synchronized = 0;
  const stripe = { enabled: true, mode, constructAccountNotification: (_raw, signature) => {
    if (signature !== 'valid-thin-signature') throw new Error('Bad signature'); return { id: 'evt_thin' };
  }, retrieveAccountNotification: async () => { reads += 1; return event; }, constructWebhookEvent: raw => JSON.parse(raw) };
  const models = { PaymentAccount: { findOne: async ({ where }) => { assert.equal(where.mode, mode); return account; } }, StripeWebhookReceipt: { findOrCreate: async ({ where }) => {
    assert.equal(where.mode, mode);
    writes += 1; return [{ ...where, status: 'pending', update: async () => { writes += 1; } }];
  } } };
  const service = createStripeWebhookService({ models, stripe, paymentAccounts: { synchronizeTrusted: async id => { assert.equal(id, 'acct_known'); synchronized += 1; } } });
  return { service, counts: () => ({ reads, writes, synchronized }) };
}
const event = () => ({ id: 'evt_thin', object: 'v2.core.event', type: 'v2.core.account[configuration.merchant].capability_status_updated', livemode: false, related_object: { id: 'acct_known', type: 'v2.core.account' } });
test('thin account signature is verified before provider retrieval or mutations', async () => {
  const f = fixture(event());
  await assert.rejects(f.service.receiveAccountNotification(Buffer.from('{}'), 'forged'), { code: 'INVALID_WEBHOOK' });
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, synchronized: 0 });
});
test('live webhooks remain account scoped and ignore signed cross-mode snapshots without processing them', async () => {
  const e = { ...event(), livemode: true };
  const account = { id: 'local', stripeAccountId: 'acct_known', lifecycleState: 'active', mode: 'live' };
  const f = fixture(e, { account, mode: 'live' });
  await f.service.receiveAccountNotification(Buffer.from('{}'), 'valid-thin-signature');
  await f.service.receive(JSON.stringify({ id: 'evt_snapshot', type: 'account.updated', account: 'acct_known', livemode: true }), 'signature');
  assert.deepEqual(f.counts(), { reads: 1, writes: 4, synchronized: 2 });
  for (const livemode of [false, undefined, null, 'true']) {
    const invalid = fixture({ ...e, livemode }, { account, mode: 'live' });
    await assert.rejects(invalid.service.receiveAccountNotification(Buffer.from('{}'), 'valid-thin-signature'), { code: 'INVALID_WEBHOOK' });
    const body = JSON.stringify({ id: 'evt_snapshot', type: 'account.updated', account: 'acct_known', livemode });
    if (livemode === false) assert.deepEqual(await invalid.service.receive(body, 'signature'), { received: true, ignored: true });
    else await assert.rejects(invalid.service.receive(body, 'signature'), { code: 'INVALID_WEBHOOK' });
    assert.equal(invalid.counts().writes, 0); assert.equal(invalid.counts().synchronized, 0);
  }
  for (const [mode, livemode] of [['test', true], ['live', false]]) {
    let retrieved = 0;
    const stripe = { enabled: true, mode, constructWebhookEvent: raw => JSON.parse(raw), retrieveCheckoutSession: async () => { retrieved++; } };
    const service = createStripeWebhookService({ stripe, models: { PaymentAccount: { findOne: async () => assert.fail('Cross-mode database lookup') } } });
    assert.deepEqual(await service.receive(JSON.stringify({ id: 'evt_opposite_mode', type: 'checkout.session.completed', account: 'acct_known', livemode }), 'signature'), { received: true, ignored: true });
    assert.equal(retrieved, 0);
  }
});
test('independently retrieved thin event must match notification identity, account object, type and sandbox mode', async () => {
  for (const change of [e => { e.id = 'other'; }, e => { e.object = 'event'; }, e => { e.livemode = true; }, e => { e.type = 'checkout.session.completed'; },
    e => { e.related_object.type = 'customer'; }, e => { e.related_object.id = 'cus_unknown'; }]) {
    const e = event(); change(e); const f = fixture(e);
    await assert.rejects(f.service.receiveAccountNotification(Buffer.from('{}'), 'valid-thin-signature'), { code: 'INVALID_WEBHOOK' });
    assert.equal(f.counts().writes, 0);
  }
});
test('genuine signed events for unregistered accounts acknowledge ignored without writes', async () => {
  const f = fixture(event());
  assert.deepEqual(await f.service.receiveAccountNotification(Buffer.from('{}'), 'valid-thin-signature'), { received: true, ignored: true });
  assert.deepEqual(f.counts(), { reads: 1, writes: 0, synchronized: 0 });
  assert.deepEqual(await f.service.receive(JSON.stringify({ id: 'evt_snapshot', type: 'account.updated', account: 'acct_unknown', livemode: false }), 'signature'), { received: true, ignored: true });
  assert.equal(f.counts().writes, 0);
});
test('known thin updates invoke trusted account retrieval and archived profiles cannot reopen', async () => {
  const f = fixture(event(), { account: { id: 'local', stripeAccountId: 'acct_known', lifecycleState: 'active' } });
  await f.service.receiveAccountNotification(Buffer.from('{}'), 'valid-thin-signature');
  assert.deepEqual(f.counts(), { reads: 1, writes: 2, synchronized: 1 });
  const archived = fixture(event(), { account: { id: 'local', stripeAccountId: 'acct_known', lifecycleState: 'archived' } });
  await archived.service.receiveAccountNotification(Buffer.from('{}'), 'valid-thin-signature');
  assert.equal(archived.counts().synchronized, 0);
});
