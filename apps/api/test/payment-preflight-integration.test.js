const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { QueryTypes } = require('sequelize');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { getConfig } = require('../src/config');
const { createSequelize } = require('../src/db/sequelize');
const { initModels } = require('../src/db/models');
const { createApp } = require('../src/app');
const { createPaymentPreflight, REQUIRED_MIGRATIONS } = require('../src/diagnostics/payment-preflight');
const { paymentRuntimeEvidence } = require('../src/diagnostics/payment-runtime');

const snapshotAt = new Date();
const staticStripeConfig = {
  STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_offlinepreflight', STRIPE_PUBLISHABLE_KEY: 'pk_test_offlinepreflight',
  STRIPE_WEBHOOK_SECRET: 'whsec_offlinepayment', STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_offlineaccount',
  CUSTOMER_APP_URL: 'https://customer.nitewide.test', BUSINESS_APP_URL: 'https://business.nitewide.test/app',
};
const provider = { mode: 'test', enabled: true };
const readyProfile = {
  mode: 'test', accountApiVersion: 'v2', lifecycleState: 'active', chargesEnabled: true, payoutsEnabled: true,
  detailsSubmitted: true, cardPaymentsActive: true, controllerMatches: true, synchronizedAt: snapshotAt,
  paymentsDisabledAt: null, disconnectStatus: 'none',
};

function counts(report, expected) {
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, report.routing[key]])), expected);
}

test('payment preflight reads real schema and merchant routes without provider calls or commerce writes', { timeout: 45000 }, async t => {
  const databaseUrl = assertManagedTestDatabase();
  // The runner supplies only the managed disposable database. Every provider
  // value below is a fixed offline fixture, never an ambient credential.
  const config = getConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, LOG_LEVEL: 'silent', ...staticStripeConfig });
  const db = createSequelize(config), models = initModels(db);
  const originalQuery = db.query.bind(db);
  let readOnlyInspections = 0;
  db.query = async (sql, options) => {
    if (typeof sql === 'string' && sql.includes('FROM information_schema.columns')) {
      const [settings] = await originalQuery("SELECT current_setting('transaction_read_only') AS read_only, current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout", {
        transaction: options.transaction, type: QueryTypes.SELECT, logging: false,
      });
      assert.equal(settings.read_only, 'on', 'PostgreSQL itself must enforce the read-only snapshot');
      assert.equal(settings.statement_timeout, '3s');
      assert.equal(settings.lock_timeout, '1s');
      readOnlyInspections++;
    }
    return originalQuery(sql, options);
  };
  let providerCalls = 0;
  const stripe = new Proxy(provider, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'string' && /^(create|retrieve|expire|disconnect|construct)/.test(key)) return () => { providerCalls++; throw new Error('Preflight must not call a provider'); };
      return undefined;
    },
  });
  const inspect = (changes = {}, stripeChanges = {}) => createPaymentPreflight({
    sequelize: db, models, config: { ...config, ...changes }, stripe: Object.assign(Object.create(stripe), stripeChanges), now: () => snapshotAt,
  }).inspect();
  try {
    const admin = await models.User.create({ email: `${randomUUID()}@offline.nitewide.test`, displayName: 'Preflight admin', isInternalAdmin: true });
    const owner = await models.User.create({ email: `${randomUUID()}@offline.nitewide.test`, displayName: 'Preflight owner' });
    const goodOrg = await models.Organization.create({ name: 'Preflight merchant private name', slug: `preflight-${randomUUID()}` });
    const unconfiguredOrg = await models.Organization.create({ name: 'Unconfigured preflight merchant', slug: `preflight-${randomUUID()}` });
    const canonicalOrg = await models.Organization.create({ name: 'Shared sandbox canonical merchant', slug: `preflight-${randomUUID()}` });
    const profile = async (organizationId, name) => models.PaymentAccount.create({ ...readyProfile, organizationId, name, stripeAccountId: `acct_${randomUUID().replaceAll('-', '')}` });
    const defaultProfile = await profile(goodOrg.id, 'Default private profile');
    const explicitProfile = await profile(goodOrg.id, 'Explicit private profile');
    const sharedProfile = await profile(canonicalOrg.id, 'Shared private profile');
    await goodOrg.update({ defaultPaymentAccountId: defaultProfile.id });
    const event = async (organizationId, changes = {}, offeringChanges = {}) => {
      const saved = await models.Event.create({ organizationId, creatorUserId: owner.id, title: 'Private preflight fixture title',
        slug: `preflight-${randomUUID()}`, status: 'published', startsAt: new Date(+snapshotAt + 3600000), endsAt: new Date(+snapshotAt + 7200000), ...changes });
      await models.Offering.create({ eventId: saved.id, name: 'Private preflight offering', priceCents: 2000, inventoryMode: 'unlimited', ...offeringChanges });
      return saved;
    };
    await event(goodOrg.id);
    const explicitEvent = await event(goodOrg.id, { paymentAccountId: explicitProfile.id });
    await event(unconfiguredOrg.id);
    const freeEvent = await event(unconfiguredOrg.id, {}, { priceCents: 0 });
    const freeOffering = await models.Offering.findOne({ where: { eventId: freeEvent.id } });
    await event(unconfiguredOrg.id, {}, { isActive: false });
    await event(unconfiguredOrg.id, { status: 'draft' });
    await event(unconfiguredOrg.id, { status: 'cancelled' });
    await event(unconfiguredOrg.id, { lifecycleState: 'archived' });
    await event(unconfiguredOrg.id, { startsAt: new Date(+snapshotAt - 7200000), endsAt: new Date(+snapshotAt - 3600000) });

    await t.test('default and explicit routes are counted once; free and inactive offerings do not block', async () => {
      const report = await inspect();
      assert.equal(report.schema.status, 'ready');
      assert.equal(report.routing.status, 'blocked');
      counts(report, { activePaidEventCount: 3, readyEventCount: 2, blockedEventCount: 1,
        eventSpecificCount: 1, organizationDefaultCount: 2, sharedSandboxCount: 0 });
      const encoded = JSON.stringify(report);
      for (const value of [goodOrg.id, explicitEvent.id, defaultProfile.id, defaultProfile.stripeAccountId,
        goodOrg.name, explicitEvent.title, config.STRIPE_SECRET_KEY, config.STRIPE_PUBLISHABLE_KEY,
        config.STRIPE_WEBHOOK_SECRET, config.STRIPE_ACCOUNT_WEBHOOK_SECRET, config.DATABASE_URL, config.CUSTOMER_APP_URL]) {
        assert.ok(!encoded.includes(value), `Diagnostic output must omit private fixture value ${value}`);
      }
    });

    await t.test('stored default readiness fails closed for restricted, stale, future and deauthorized profiles', async () => {
      for (const changes of [
        { chargesEnabled: false }, { detailsSubmitted: false }, { cardPaymentsActive: false }, { controllerMatches: false },
        { synchronizedAt: new Date(+snapshotAt - 300001) }, { synchronizedAt: new Date(+snapshotAt + 1) },
        { synchronizedAt: null }, { lifecycleState: 'archived' }, { paymentsDisabledAt: snapshotAt },
        { disconnectStatus: 'pending', paymentsDisabledAt: snapshotAt }, { disconnectStatus: 'disconnected', paymentsDisabledAt: snapshotAt },
      ]) {
        await defaultProfile.update(changes);
        counts(await inspect(), { activePaidEventCount: 3, readyEventCount: 1, blockedEventCount: 2 });
        await defaultProfile.update(readyProfile);
      }
      await defaultProfile.update({ synchronizedAt: new Date(+snapshotAt - 300000) });
      counts(await inspect(), { readyEventCount: 2, blockedEventCount: 1 });
      await defaultProfile.update(readyProfile);
    });

    await t.test('an explicit foreign or archived profile cannot fall back to the ready organization default', async () => {
      await explicitEvent.update({ paymentAccountId: sharedProfile.id });
      counts(await inspect(), { readyEventCount: 1, blockedEventCount: 2, eventSpecificCount: 1 });
      await explicitEvent.update({ paymentAccountId: explicitProfile.id });
      await explicitProfile.update({ lifecycleState: 'archived' });
      counts(await inspect(), { readyEventCount: 1, blockedEventCount: 2 });
      await explicitProfile.update(readyProfile);
      await goodOrg.update({ status: 'suspended' });
      counts(await inspect(), { readyEventCount: 0, blockedEventCount: 3 });
      await goodOrg.update({ status: 'active' });
      await goodOrg.update({ lifecycleState: 'suspended' });
      counts(await inspect(), { readyEventCount: 0, blockedEventCount: 3 });
      await goodOrg.update({ lifecycleState: 'active' });
    });

    await t.test('the shared sandbox route uses its canonical active merchant and checks both organizations', async () => {
      const sharedConfig = { STRIPE_SANDBOX_SHARED_ACCOUNT_ID: sharedProfile.stripeAccountId };
      const sharedStripe = { sandboxSharedAccountId: sharedProfile.stripeAccountId };
      const sharedInspect = () => inspect(sharedConfig, sharedStripe);
      counts(await sharedInspect(), { activePaidEventCount: 3, readyEventCount: 3, blockedEventCount: 0,
        sharedSandboxCount: 3, eventSpecificCount: 0, organizationDefaultCount: 0 });
      await canonicalOrg.update({ status: 'suspended' });
      counts(await sharedInspect(), { readyEventCount: 0, blockedEventCount: 3 });
      await canonicalOrg.update({ status: 'active' });
      await unconfiguredOrg.update({ lifecycleState: 'suspended' });
      counts(await sharedInspect(), { readyEventCount: 2, blockedEventCount: 1 });
      await unconfiguredOrg.update({ lifecycleState: 'active' });
      await sharedProfile.update({ paymentsDisabledAt: snapshotAt, disconnectStatus: 'disconnected' });
      counts(await sharedInspect(), { readyEventCount: 0, blockedEventCount: 3 });
      await sharedProfile.update(readyProfile);
    });

    await t.test('live routes reject sandbox merchants and disabled live credentials do not inspect routes', async () => {
      const liveConfig = { NODE_ENV: 'production', APP_ENVIRONMENT: 'production', HOSTED_DEMO: 'false',
        STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_offlinepreflight', STRIPE_PUBLISHABLE_KEY: 'pk_live_offlinepreflight',
        RELEASE_REVISION: 'a'.repeat(40), corsOrigins: ['https://customer.nitewide.test', 'https://business.nitewide.test'] };
      const inspectLive = () => inspect(liveConfig, { mode: 'live' });
      counts(await inspectLive(), { activePaidEventCount: 3, readyEventCount: 0, blockedEventCount: 3 });
      await defaultProfile.update({ mode: 'live' });
      counts(await inspectLive(), { activePaidEventCount: 3, readyEventCount: 1, blockedEventCount: 2 });
      counts(await inspect(), { activePaidEventCount: 3, readyEventCount: 1, blockedEventCount: 2 });
      const before = readOnlyInspections;
      const disabled = await inspect({ ...liveConfig, STRIPE_MODE: 'disabled' }, { mode: 'disabled', enabled: false });
      assert.equal(disabled.mode, 'disabled'); assert.equal(disabled.routing.status, 'not-checked');
      assert.equal(readOnlyInspections, before);
      const otherLiveProfile = await profile(unconfiguredOrg.id, 'Live private profile');
      await otherLiveProfile.update({ mode: 'live' });
      await unconfiguredOrg.update({ defaultPaymentAccountId: otherLiveProfile.id });
      await explicitProfile.update({ mode: 'live' });
      const workerId = randomUUID();
      const workerEvidence = paymentRuntimeEvidence({ ...config, ...liveConfig });
      await db.query(`INSERT INTO background_workers(id,status,heartbeat_at,details)
        VALUES(:id,'running',:observedAt,CAST(:details AS jsonb))`, { replacements: { id: workerId, observedAt: snapshotAt,
        details: JSON.stringify({ paymentReconciliationEnabled: true, paymentRuntime: workerEvidence }) } });
      try {
        const ready = await inspectLive();
        assert.equal(ready.mode, 'live-ready'); assert.equal(ready.workers.status, 'ready');
        counts(ready, { activePaidEventCount: 3, readyEventCount: 3, blockedEventCount: 0 });
        const sandboxEvidence = paymentRuntimeEvidence({ ...config, RELEASE_REVISION: liveConfig.RELEASE_REVISION });
        await db.query('UPDATE background_workers SET details=CAST(:details AS jsonb) WHERE id=:id', {
          replacements: { id: workerId, details: JSON.stringify({ paymentReconciliationEnabled: true, paymentRuntime: sandboxEvidence }) },
        });
        const mismatch = await inspectLive();
        assert.equal(mismatch.mode, 'configuration-blocked'); assert.equal(mismatch.workers.mismatchedWorkerCount, 1);
      } finally { await db.query('DELETE FROM background_workers WHERE id=:id', { replacements: { id: workerId } }); }
      await unconfiguredOrg.update({ defaultPaymentAccountId: null });
      await explicitProfile.update(readyProfile);
      await defaultProfile.update(readyProfile);
    });

    await t.test('internal diagnostic authorization and no-store preserve healthy liveness and free checkout', async () => {
      const app = createApp({ sequelize: db, models, config, services: { stripe, email: { enabled: false } } });
      try {
        const diagnosticPath = '/api/admin/diagnostics/payments';
        await request(app).get(diagnosticPath).expect(401).expect('Cache-Control', 'no-store');
        await request(app).get(diagnosticPath).set('x-user-id', owner.id).expect(403).expect('Cache-Control', 'no-store');
        const response = await request(app).get(diagnosticPath).set('x-user-id', admin.id).expect(200).expect('Cache-Control', 'no-store');
        assert.equal(response.body.data.routing.status, 'blocked');
        for (const path of ['/health/live', '/health/ready', '/health']) await request(app).get(path).expect(200).expect('Cache-Control', 'no-store');
        const purchase = await request(app).post('/api/orders').set('x-user-id', owner.id).send({ eventId: freeEvent.id,
          idempotencyKey: randomUUID(), items: [{ offeringId: freeOffering.id, quantity: 1 }] }).expect(201);
        assert.equal(purchase.body.data.order.status, 'paid');
        assert.equal((await models.Payment.findOne()).provider, 'free');
      } finally { await app.locals.reportExports?.stop(); }
    });

    await t.test('missing merchant columns and tables block before route reads', async () => {
      await db.query('ALTER TABLE public.payment_accounts RENAME COLUMN controller_matches TO preflight_fixture_hidden_controller');
      try {
        const report = await inspect();
        assert.equal(report.schema.status, 'blocked');
        assert.equal(report.schema.missingColumnCount, 1);
        assert.equal(report.routing.status, 'not-checked');
      } finally { await db.query('ALTER TABLE public.payment_accounts RENAME COLUMN preflight_fixture_hidden_controller TO controller_matches'); }
      await db.query('ALTER TABLE public.payment_accounts RENAME TO preflight_fixture_hidden_accounts');
      try {
        const report = await inspect();
        assert.equal(report.schema.status, 'blocked');
        assert.ok(report.schema.missingTableCount >= 1);
        assert.equal(report.routing.status, 'not-checked');
      } finally { await db.query('ALTER TABLE public.preflight_fixture_hidden_accounts RENAME TO payment_accounts'); }
    });

    await t.test('schema shape cannot substitute for the required payment migration ledger', async () => {
      const migration = REQUIRED_MIGRATIONS.at(-1);
      assert.equal(typeof migration, 'string');
      await db.query('DELETE FROM sequelize_meta WHERE name = :migration', { replacements: { migration } });
      try {
        const report = await inspect();
        assert.equal(report.schema.status, 'blocked');
        assert.equal(report.schema.missingMigrationCount, 1);
        assert.equal(report.routing.status, 'not-checked');
      } finally { await db.query('INSERT INTO sequelize_meta (name) VALUES (:migration)', { replacements: { migration } }); }
      assert.equal((await inspect()).schema.status, 'ready');
    });

    assert.equal(providerCalls, 0);
    assert.ok(readOnlyInspections > 10, 'Real PostgreSQL transaction guards were observed throughout route and schema inspections');
    assert.equal(await models.Order.count(), 1, 'Only the explicit free checkout creates commerce');
    assert.equal(await models.Payment.count(), 1);
  } finally { await db.close(); }
});
