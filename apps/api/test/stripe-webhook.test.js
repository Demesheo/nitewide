const test = require('node:test');
const assert = require('node:assert/strict');
const { createStripeWebhookService } = require('../src/services/stripe-webhook-service');
function fixture(event, { account = null } = {}) {
  let reads = 0, writes = 0, synchronized = 0;
  const stripe = { enabled: true, mode: 'test', constructAccountNotification: (_raw, signature) => {
    if (signature !== 'valid-thin-signature') throw new Error('Bad signature'); return { id: 'evt_thin' };
  }, retrieveAccountNotification: async () => { reads += 1; return event; }, constructWebhookEvent: raw => JSON.parse(raw) };
  const models = { PaymentAccount: { findOne: async () => account }, StripeWebhookReceipt: { findOrCreate: async () => {
    writes += 1; return [{ status: 'pending', update: async () => { writes += 1; } }];
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
