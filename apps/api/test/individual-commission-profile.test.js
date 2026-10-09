const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createIndividualCommissionProfileService } = require('../src/services/individual-commission-profile-service');

function fixture(mode = 'live') {
  let profile, remote, remoteCalls = 0;
  const at = new Date('2026-10-08T12:00:00Z');
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = { query: async () => [], transaction: async (_options, work) => work(transaction) };
  const models = {
    User: { findByPk: async id => ({ id, isActive: true }) },
    AuditLog: { create: async () => {} },
    CommissionEarning: { count: async () => 1 },
    CommissionPayment: { count: async () => 0 },
    PaymentAccount: { count: async () => 0 },
    IndividualCommissionProfile: {
      findOne: async ({ where }) => profile && Object.entries(where).every(([key, value]) => profile[key] === value) ? profile : null,
      create: async values => (profile = { ...values, id: randomUUID(), createdAt: at, lifecycleState: 'active', disconnectStatus: 'none',
        update: async function (next) { Object.assign(this, next); return this; } }),
    },
  };
  const stripe = { mode, disconnectEnabled: true,
    createAccount: async input => {
      remoteCalls++;
      remote = { id: 'acct_individual', object: 'v2.core.account', livemode: mode === 'live', metadata: input.metadata,
        identity: { entity_type: 'individual' }, dashboard: 'full', applied_configurations: ['merchant'],
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
        configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, ach_debit_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } },
        requirements: { entries: [] } };
      return remote;
    },
    retrieveIndividualAccount: async () => { remoteCalls++; return structuredClone(remote); },
    createAccountLink: async input => { remoteCalls++; return { object: 'v2.core.account_link', account: input.account, livemode: mode === 'live', url: 'https://connect.stripe.test/single-use', expires_at: '2026-10-08T13:00:00Z' }; },
    disconnectAccount: async () => { remoteCalls++; return { disconnected: true }; },
  };
  const serviceFor = provider => createIndividualCommissionProfileService({ sequelize, models, stripe: provider, now: () => at,
    businessAppUrl: 'https://business.example.test/app', customerAppUrl: 'https://customer.example.test' });
  return { stripe, service: serviceFor(stripe), serviceFor, profile: () => profile, remote: () => remote, calls: () => remoteCalls };
}

test('live personal onboarding requires matching verified individual evidence and uses the live dashboard', async () => {
  const f = fixture();
  assert.equal((await f.service.get('person')).providerMode, 'live');
  const body = { displayName: 'Promoter', idempotencyKey: randomUUID() };
  const created = await f.service.create('person', body);
  assert.equal(created.providerMode, 'live'); assert.equal(created.cardReady, false);
  await f.service.onboarding('person');
  const verified = await f.service.synchronize('person');
  assert.equal(verified.eligibility.eligible, true); assert.equal(verified.cardReady, true); assert.equal(verified.bankReady, true);
  assert.equal((await f.service.dashboard('person')).url, 'https://dashboard.stripe.com/acct_individual/dashboard');
  f.remote().livemode = false;
  const rejected = await f.service.synchronize('person');
  assert.equal(rejected.cardReady, false); assert.equal(rejected.bankReady, false); assert.equal(rejected.status, 'inactive');
});

test('a retained sandbox profile cannot become live, call a live account API, or grant eligibility', async () => {
  const f = fixture('test'), body = { displayName: 'Promoter', idempotencyKey: randomUUID() };
  await f.service.create('person', body); await f.service.synchronize('person');
  const live = f.serviceFor({ ...f.stripe, mode: 'live' }), count = f.calls();
  const displayed = await live.get('person');
  assert.equal(displayed.cardReady, false); assert.equal(displayed.eligibility.eligible, false); assert.equal(displayed.disconnectAvailable, false);
  for (const operation of [() => live.create('person', body), () => live.onboarding('person'), () => live.dashboard('person'), () => live.resume('person'), () => live.disconnect('person')]) {
    await assert.rejects(operation(), { code: 'COMMISSION_PROFILE_MODE_MISMATCH' });
  }
  await assert.rejects(live.synchronize('person'), { code: 'NOT_FOUND' });
  await live.deauthorizeTrusted('acct_individual');
  assert.equal(f.profile().deauthorizedAt, undefined); assert.equal(f.profile().providerMode, 'test');
  assert.equal(f.calls(), count);
});

test('individual onboarding rejects foreign-mode account links and disabled runtimes show no readiness', async () => {
  const f = fixture(); await f.service.create('person', { displayName: 'Promoter', idempotencyKey: randomUUID() });
  await f.service.synchronize('person');
  f.stripe.createAccountLink = async () => ({ object: 'v2.core.account_link', account: 'acct_individual', livemode: false, url: 'https://connect.stripe.test/untrusted', expires_at: '2026-10-08T13:00:00Z' });
  await assert.rejects(f.service.onboarding('person'), { code: 'COMMISSION_PROFILE_VERIFICATION_FAILED' });
  const disabled = await f.serviceFor({ mode: 'disabled' }).get('person');
  assert.equal(disabled.cardReady, false); assert.equal(disabled.disconnectAvailable, false);
});
