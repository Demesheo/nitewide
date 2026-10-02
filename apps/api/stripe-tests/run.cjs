#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { assertSandboxInvocation, sandboxCredentials, createStripeTestIdentity, accountParameters, assertOwnedSandboxAccount, verifiedReadiness, safeFailure, STRIPE_API_VERSION, reusableSandboxAccount } = require('./sandbox-policy.cjs');
const { createRuntime, command: runCommand } = require('./runtime.cjs');
const { maintenanceUrl, postgresUrl, assertGeneratedDatabaseName, offlineEnvironment } = require('../scripts/test-database.cjs');
const root = path.resolve(__dirname, '../../..');
const apiRoot = path.join(root, 'apps/api');

async function main(args = process.argv.slice(2)) {
  const local = fs.existsSync(path.join(root, '.env')) ? require('dotenv').parse(fs.readFileSync(path.join(root, '.env'), 'utf8')) : {};
  const source = { ...local, ...process.env };
  assertSandboxInvocation(args, source);
  const previous = args[1] === '--resume' ? JSON.parse(fs.readFileSync(path.join(root, 'test-results/stripe-sandbox', `${args[2]}.json`), 'utf8')) : null;
  const requestedAccount = reusableSandboxAccount(args, source);
  const identity = previous ? { testIdentifier: args[2], email: `test+${args[2]}@nitewide.com` }
    : createStripeTestIdentity(requestedAccount ? 'payment-regression' : 'api-onboarding');
  if (previous && (previous.email !== identity.email || previous.mode !== 'test' || !/^acct_[A-Za-z0-9]+$/.test(previous.stripeAccountId || ''))) throw new Error('Resume requires a valid local sandbox report containing a tagged connected account.');
  const existingBusiness = Boolean(requestedAccount || previous?.accountSource === 'existing-business');
  if (existingBusiness) Object.assign(identity, { accountSource: 'existing-business', expectedStripeAccountId: requestedAccount || previous.stripeAccountId,
    sourcePaymentProfileId: previous?.sourcePaymentProfileId });
  const report = { testIdentifier: identity.testIdentifier, email: identity.email, apiVersion: STRIPE_API_VERSION,
    startedAt: new Date().toISOString(), mode: 'test', realMoney: false, resendEmails: 0,
    webhookTransport: 'retrieved-provider-events-replayed-to-local-signed-HTTP-receiver',
    manualHostedOnboarding: 'Separate manual check; no dashboard credentials or MFA are automated.', checks: [] };
  const reportPath = path.join(root, 'test-results/stripe-sandbox', `${identity.testIdentifier}.json`);
  const save = () => { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); };
  const check = (name, result = 'passed') => { report.checks.push({ name, result }); save(); console.log(`${result.toUpperCase()}: ${name}`); };
  const name = assertGeneratedDatabaseName(`nitewide_test_${randomUUID().replaceAll('-', '')}`);
  const adminUrl = maintenanceUrl(source), databaseUrl = postgresUrl(adminUrl); databaseUrl.pathname = `/${name}`;
  const env = { ...offlineEnvironment(process.env), DATABASE_URL: databaseUrl.toString(), TEST_DATABASE_URL: databaseUrl.toString(),
    TEST_DATABASE_MANAGED: '1', DATABASE_SSL: 'false', DATABASE_SSL_CA: '', DATABASE_SSL_CA_FILE: '',
    AUTH_TOKEN_SECRET: 'stripe-sandbox-isolated-session-key-not-production', QR_TOKEN_SECRET: 'stripe-sandbox-isolated-qr-key-not-production',
    EMAIL_ENCRYPTION_KEY: 'stripe-sandbox-isolated-email-key-not-production' };
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: 'nitewide-stripe-sandbox-test' });
  const runtime = createRuntime();
  const command = (args, environment) => runCommand(args, environment, { cwd: root, signal: runtime.signal });
  const step = name => { runtime.check(); report.currentStep = name; save(); };
  let created = false, sequelize;
  try {
    // Run actual mocked regressions before making any external writes.
    step('offline prerequisites');
    await command(['--test', ...['stripe-sandbox-runner.test.js', 'stripe-sandbox-cleanup.test.js', 'stripe-application-fee-evidence.test.js', 'stripe-connect-fixtures.test.js', 'stripe-client.test.js', 'stripe-verification.test.js', 'stripe-webhook.test.js'].map(f => path.join(apiRoot, 'test', f))], offlineEnvironment());
    check('offline payment/webhook/runner prerequisites');
    await command([path.join(apiRoot, 'scripts/run-tests.cjs'), '--integration', '--suite', 'stripe-checkout-integration.test.js'], {
      ...offlineEnvironment(), TEST_DATABASE_ADMIN_URL: adminUrl });
    check('mocked PostgreSQL checkout, retry, refund and authorization regressions');
    step('isolated database setup');
    await client.connect();
    await client.query(`CREATE DATABASE "${name}"`); created = true;
    await command([require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--config', 'apps/api/src/db/config.cjs', '--migrations-path', 'apps/api/src/db/migrations', '--env', 'test'], env);
    const config = require('../src/config').getConfig(env);
    sequelize = require('../src/db/sequelize').createSequelize(config);
    const models = require('../src/db/models').initModels(sequelize);
    const sdk = new (require('stripe'))(source.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, timeout: 12000, maxNetworkRetries: 1 });
    const credentials = sandboxCredentials(source);
    const stripe = require('../src/payments/stripe-client').createStripeClient(credentials, { sdk });
    console.log(`${existingBusiness ? 'Reusing an existing Nitewide' : previous ? 'Resuming the same tagged' : 'Creating one tagged'} sandbox merchant; test identity: ${identity.email}`);
    step('tagged sandbox account provisioning');
    const account = existingBusiness ? await stripe.retrieveAccount(identity.expectedStripeAccountId)
      : previous ? await stripe.retrieveAccount(previous.stripeAccountId)
      : await sdk.v2.core.accounts.create(accountParameters(identity), { idempotencyKey: `nitewide-sandbox-${identity.testIdentifier}` });
    if (requestedAccount) identity.sourcePaymentProfileId = account.metadata?.nitewide_payment_account_id;
    if (existingBusiness) Object.assign(report, { accountSource: identity.accountSource, sourcePaymentProfileId: identity.sourcePaymentProfileId });
    report.stripeAccountId = account.id; save();
    assertOwnedSandboxAccount(account, identity);
    check(`${existingBusiness ? 'reused Nitewide' : 'API-created'} Accounts v2 merchant preserves full Dashboard and Stripe-owned fees/losses`);
    // Full-Dashboard merchants must configure their payout bank and accept
    // terms in Stripe's hosted UI. Stripe forbids us doing either on their
    // behalf. A capability gate must not turn into an authentication bypass.
    step('account status HTTP webhook');
    // Reusing a merchant must not modify its metadata or bindings in the
    // development/Render apps. Payment events are still checked through HTTP.
    const remote = existingBusiness ? assertOwnedSandboxAccount(await stripe.retrieveAccount(account.id), identity)
      : await require('./account-webhook-check.cjs').checkAccountWebhook({ env, credentials, sdk, stripe, sequelize, models, account, identity, check, signal: runtime.signal });
    if (existingBusiness) check('existing merchant independently retrieved without changing its onboarding, metadata or application bindings');
    report.capabilities = { cardPayments: remote.configuration?.merchant?.capabilities?.card_payments?.status,
      payouts: remote.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status };
    report.outstandingRequirements = (remote.requirements?.entries || []).filter(e => ['currently_due', 'past_due'].includes(e.minimum_deadline?.status)).map(e => e.description);
    save();
    step('provider-verified onboarding readiness');
    if (!verifiedReadiness(remote)) {
      check('provider-verified onboarding readiness', 'blocked');
      for (const name of ['Stripe Elements sandbox payment and retry', 'payment webhook fulfillment and replay', 'customer QR pass recovery', 'provider-verified full refund']) check(name, 'not-run');
      throw Object.assign(new Error('Sandbox readiness not granted; complete provider requirements without weakening account policy.'), { code: 'SANDBOX_ONBOARDING_REQUIRED' });
    }
    check('provider-verified onboarding readiness');
    step('sandbox payment and refund');
    await require('./payment-flow.cjs').runPaymentFlow({ root, env, credentials, sdk, stripe, sequelize, models, account: remote, identity, check, report, save, command, signal: runtime.signal });
    report.status = 'passed';
  } catch (error) {
    report.status = report.checks.some(c => c.result === 'blocked') ? 'blocked' : 'failed';
    report.failureStep = report.currentStep;
    report.failure = safeFailure(error);
    console.error(`Sandbox test ${report.status}: ${JSON.stringify(report.failure)}`);
    if (report.stripeAccountId) console.error(`Tagged test account retained for inspection: ${report.stripeAccountId}`);
    process.exitCode = 1;
  } finally {
    try {
      if (sequelize) await sequelize.close();
    } catch (error) { report.cleanupFailure = safeFailure(error); }
    try {
      if (created) { await client.query(`DROP DATABASE "${assertGeneratedDatabaseName(name)}" WITH (FORCE)`); console.log('Removed only the disposable sandbox test database.'); }
    } catch (error) { report.cleanupFailure = { ...safeFailure(error), databaseName: name }; }
    finally { await client.end().catch(error => { report.cleanupFailure ||= safeFailure(error); }); runtime.dispose(); }
    if (report.cleanupFailure || report.providerCleanupFailure) { report.status = 'failed'; process.exitCode = 1; console.error(`Sandbox cleanup needs attention: ${JSON.stringify(report.cleanupFailure || report.providerCleanupFailure)}`); }
    report.finishedAt = new Date().toISOString(); delete report.currentStep; save();
    console.log(`Redacted sandbox report: ${reportPath}`);
  }
  return report;
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify(safeFailure(error))); process.exitCode = 1; });
module.exports = { main };
