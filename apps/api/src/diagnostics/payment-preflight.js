const { QueryTypes, Transaction } = require('sequelize');
const ipaddr = require('ipaddr.js');
const { paymentsReady } = require('../services/business-payment-account-service');
const { paymentRuntimeEvidence } = require('./payment-runtime');
const { subdomainApps } = require('../domain/app-routing');
const { isStripeMode } = require('../payments/stripe-mode');
const { validateStripeSettings } = require('../payments/stripe-settings');
const { stripeServerKeyMode, stripePublishableKeyMode } = require('../payments/stripe-keys');

const REQUIRED_MIGRATIONS = Object.freeze([
  '202609300006-email-worker-leases.cjs', '202610010006-stripe-sandbox.cjs',
  '202610010007-stripe-accounts-v2.cjs', '202610010008-payment-disconnect.cjs',
  '202610010009-payment-control-version.cjs', '202610010010-payment-merchant-selection.cjs',
  '202610010011-checkout-reminders.cjs',
  '202610020002-commission-payments.cjs', '202610020003-commission-ledger.cjs',
  '202610020004-organizer-messages.cjs',
  '202610020005-purchase-disputes.cjs',
  '202610090002-live-stripe.cjs',
  '202610090003-commission-billing-email.cjs',
]);
const BASE_SCHEMA = Object.freeze({
  sequelize_meta: ['name'],
  organizations: ['id', 'status', 'lifecycle_state', 'default_payment_account_id'],
  organization_owners: ['payment_disconnect_authorized'],
  events: ['id', 'organization_id', 'payment_account_id', 'status', 'lifecycle_state', 'ends_at'],
  offerings: ['event_id', 'is_active', 'price_cents', 'quantity_reserved'],
  payment_accounts: ['id', 'organization_id', 'stripe_account_id', 'mode', 'account_api_version',
    'charges_enabled', 'payouts_enabled', 'details_submitted', 'card_payments_active', 'controller_matches',
    'capabilities', 'requirements', 'synchronized_at', 'lifecycle_state', 'payments_disabled_at',
    'disconnect_status', 'disconnect_request_id', 'disconnect_attempt_at', 'disconnected_at', 'disconnect_error_code', 'control_version'],
  orders: ['payment_account_id', 'stripe_account_id', 'checkout_session_id', 'provider_mode',
    'provider_verification_status', 'stripe_payment_intent_id', 'stripe_charge_id', 'application_fee_cents',
    'reservation_expires_at', 'reservation_released_at'],
  order_items: ['id', 'order_id', 'offering_id'],
  payments: ['order_id', 'provider', 'status', 'provider_reference'],
  tickets: ['order_item_id', 'status'],
  notifications: ['kind', 'metadata'],
  notification_jobs: ['order_id', 'status'],
  audit_logs: ['action', 'after'],
  order_refund_requests: ['order_id', 'status'],
  stripe_webhook_receipts: ['stripe_event_id', 'stripe_account_id', 'mode', 'type', 'status', 'processed_at'],
  refunds: ['order_id', 'payment_account_id', 'stripe_account_id', 'provider_refund_id', 'status', 'amount_cents', 'idempotency_key'],
  individual_commission_profiles: ['stripe_account_id', 'provider_mode', 'account_api_version', 'verified_at', 'verified_stripe_account', 'payments_disabled_at', 'disconnect_status'],
  commission_payments: ['organization_id', 'stripe_account_id', 'provider_mode', 'status', 'provider_verification_status', 'provider_invoice_id', 'reconciliation_status', 'allocations_settled_at', 'billing_email_snapshot'],
  commission_statements: ['organization_id', 'event_id', 'recipient_user_id', 'status'],
  commission_earnings: ['order_id', 'statement_id', 'refund_hold', 'dispute_hold'],
  commission_allocations: ['payment_id'],
  purchase_disputes: ['order_id', 'stripe_dispute_id', 'stripe_account_id', 'provider_mode', 'status', 'synchronized_at'],
  background_workers: ['status', 'heartbeat_at', 'details'],
});
const MODEL_NAMES = ['Organization', 'OrganizationOwner', 'Event', 'Offering', 'PaymentAccount', 'Order', 'StripeWebhookReceipt',
  'Refund', 'IndividualCommissionProfile', 'CommissionPayment', 'CommissionStatement', 'CommissionEarning', 'CommissionAllocation', 'PurchaseDispute',
  'OrderItem', 'Payment', 'Ticket', 'Notification', 'NotificationJob', 'AuditLog', 'OrderRefundRequest'];

// Every message is fixed. No provider exceptions, configured values, row IDs,
// account names or URLs are copied into this report or its HTTP response.
const CHECK_MESSAGES = Object.freeze({
  PAYMENTS_DISABLED: 'Stripe payments are disabled. Free events and guestlists remain independent of this diagnostic.',
  STRIPE_CONFIGURATION_INVALID: 'Stripe settings must satisfy the runtime policy: matching key modes, with live credentials confined to an explicit production, non-demo deployment.',
  STRIPE_MODE_INVALID: 'Set STRIPE_MODE to disabled, test or live.',
  STRIPE_SECRET_KEY_MISSING: 'Enabled payments require STRIPE_SECRET_KEY in both API and worker environments.',
  STRIPE_SECRET_KEY_INVALID: 'STRIPE_SECRET_KEY must have the secret-key format matching STRIPE_MODE.',
  STRIPE_PUBLISHABLE_KEY_MISSING: 'Enabled payments require STRIPE_PUBLISHABLE_KEY in both API and worker environments.',
  STRIPE_PUBLISHABLE_KEY_INVALID: 'STRIPE_PUBLISHABLE_KEY must have the publishable-key format matching STRIPE_MODE.',
  STRIPE_WEBHOOK_SECRET_MISSING: 'Set STRIPE_WEBHOOK_SECRET for the connected-account snapshot webhook in both API and worker environments.',
  STRIPE_WEBHOOK_SECRET_INVALID: 'STRIPE_WEBHOOK_SECRET must have the Stripe signing-secret format.',
  STRIPE_ACCOUNT_WEBHOOK_SECRET_MISSING: 'Set STRIPE_ACCOUNT_WEBHOOK_SECRET for the Accounts v2 notification webhook in both API and worker environments.',
  STRIPE_ACCOUNT_WEBHOOK_SECRET_INVALID: 'STRIPE_ACCOUNT_WEBHOOK_SECRET must have the Stripe signing-secret format.',
  STRIPE_WEBHOOK_SECRETS_NOT_DISTINCT: 'The snapshot and Accounts v2 webhook destinations require separate signing secrets.',
  STRIPE_CONFIGURATION_FORMATS: 'Matching-mode credential and separate webhook-secret formats are configured. Their provider identity has not been verified.',
  CUSTOMER_CALLBACK_INVALID: 'Set an explicit valid CUSTOMER_APP_URL. Hosted payments require a public HTTPS URL without credentials, query or fragment.',
  BUSINESS_CALLBACK_INVALID: 'Set an explicit valid BUSINESS_APP_URL. Hosted payments require a public HTTPS URL without credentials, query or fragment.',
  CALLBACK_URLS_CONFIGURED: 'Customer and business callback URL configuration passed the deployment-format checks.',
  CALLBACK_CORS_MISMATCH: 'CORS_ORIGINS must include the configured customer and business callback origins for hosted payments.',
  HOSTED_DEMO_CALLBACK_ROUTING_MISMATCH: 'Bundled hosted-demo callbacks must share one public origin, with CUSTOMER_APP_URL at the root and BUSINESS_APP_URL at /app or /app/.',
  APP_ROUTING_INVALID: 'Subdomain routing requires distinct public HTTPS customer, business and admin URLs at their expected paths, with all three origins in CORS.',
  SHARED_SANDBOX_ROUTING: 'Shared sandbox merchant routing overrides event and business selection. It is permitted only for development, test or an explicitly hosted demo and must be removed before production payments.',
  SHARED_SANDBOX_ROUTING_FORBIDDEN: 'Remove STRIPE_SANDBOX_SHARED_ACCOUNT_ID: shared routing is allowed only in a development, test or explicitly hosted-demo sandbox runtime.',
  PAYMENT_RUNTIME_UNAVAILABLE: 'The payment runtime does not match the configured enabled Stripe mode.',
  KEY_PAIR_IDENTITY_NOT_VERIFIED: 'Key formats do not prove that the secret and publishable keys belong to the same Stripe account and mode. Verify that identity separately.',
  WEBHOOK_DELIVERY_NOT_VERIFIED: 'Configured secrets do not prove that Stripe delivers to both deployed webhook destinations. Verify delivery separately in Stripe Workbench.',
  PROVIDER_READINESS_SNAPSHOT_ONLY: 'Merchant readiness uses stored provider observations with the checkout policy freshness window. This diagnostic does not refresh Stripe or prove a future checkout will succeed.',
  PAYMENT_SCHEMA_READY: 'Required payment tables, columns and migration ledger entries are present.',
  PAYMENT_SCHEMA_MISSING: 'Payment tables, columns or migration ledger entries are missing. Apply the reviewed migrations through the normal release process before paid checkout.',
  PAYMENT_DATABASE_UNAVAILABLE: 'The read-only payment database inspection could not complete. Check database availability and retry this diagnostic.',
  PAYMENT_DIAGNOSTIC_TIMEOUT: 'The payment diagnostic deadline expired. Check database availability and retry; the in-flight inspection remains bounded and shared.',
  PAYMENT_ROUTING_READY: 'All active published paid events resolve to merchants that satisfy the current stored payment-readiness policy.',
  PAYMENT_ROUTING_BLOCKED: 'Some active published paid events have unavailable, mismatched, disabled, disconnected, unready or stale merchants. Review event and business payment selection and refresh provider status through the authorized business workflow.',
  PAYMENT_ROUTING_COMPLEXITY_LIMIT: 'Payment routing has too many distinct readiness states for this bounded inspection. Review merchant configuration before paid checkout.',
  PAID_ROUTES_MISSING: 'No active published paid events were found. This report cannot establish a working paid-event merchant route.',
  WORKER_RUNTIME_READY: 'Fresh running payment workers match this API release and payment configuration.',
  WORKER_RUNTIME_MISSING: 'No fresh running worker has matching payment reconciliation, release and configuration evidence. Check the worker release, environment settings and heartbeat.',
  WORKER_RUNTIME_MISMATCH: 'A fresh running worker has different or missing payment configuration, release or reconciliation evidence. Deploy the matching reviewed API and worker release and environment settings.',
  RELEASE_REVISION_UNKNOWN: 'This runtime has no valid release revision evidence. Hosted payment readiness requires a known API and worker release.',
  RELEASE_REVISION_MISMATCH: 'The runtime release does not match the requested release revision.',
  RELEASE_REVISION_MATCH: 'The runtime release matches the requested release revision.',
});
const check = (code, status) => ({ code, status, message: CHECK_MESSAGES[code] });
const hosted = config => config.NODE_ENV === 'production' || config.hostedDemo === true || config.HOSTED_DEMO === 'true';
const sharedAllowed = config => ['development', 'test'].includes(config.NODE_ENV)
  || config.NODE_ENV === 'production' && (config.hostedDemo === true || config.HOSTED_DEMO === 'true');

function validCallback(value, publicOnly) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return false;
    if (!publicOnly) return true;
    if (url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    return ipaddr.isValid(hostname) ? ipaddr.process(hostname).range() === 'unicast'
      : hostname.includes('.') && !/(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(hostname);
  } catch { return false; }
}

function inspectPaymentConfiguration(config = {}) {
  const checks = [];
  if (config.APP_ROUTING_MODE === 'subdomains') {
    try { subdomainApps(config); } catch { checks.push(check('APP_ROUTING_INVALID', 'fail')); }
  }
  const mode = config.STRIPE_MODE || 'disabled';
  if (mode !== 'disabled' && !isStripeMode(mode)) checks.push(check('STRIPE_MODE_INVALID', 'fail'));
  const matchingKeyMode = keyMode => isStripeMode(keyMode) && (!isStripeMode(mode) || keyMode === mode);
  const settings = [
    ['STRIPE_SECRET_KEY', value => matchingKeyMode(stripeServerKeyMode(value))],
    ['STRIPE_PUBLISHABLE_KEY', value => matchingKeyMode(stripePublishableKeyMode(value))],
    ['STRIPE_WEBHOOK_SECRET', value => /^whsec_[A-Za-z0-9]+$/.test(value)],
    ['STRIPE_ACCOUNT_WEBHOOK_SECRET', value => /^whsec_[A-Za-z0-9]+$/.test(value)],
  ];
  for (const [name, format] of settings) {
    if (isStripeMode(mode) && !config[name]) checks.push(check(`${name}_MISSING`, 'fail'));
    else if (config[name] && !format(config[name])) checks.push(check(`${name}_INVALID`, 'fail'));
  }
  if (config.STRIPE_WEBHOOK_SECRET && config.STRIPE_WEBHOOK_SECRET === config.STRIPE_ACCOUNT_WEBHOOK_SECRET) checks.push(check('STRIPE_WEBHOOK_SECRETS_NOT_DISTINCT', 'fail'));
  if (isStripeMode(mode)) {
    if (!checks.some(item => item.status === 'fail')) checks.push(check('STRIPE_CONFIGURATION_FORMATS', 'pass'));
    const callbackValues = [config.CUSTOMER_APP_URL, config.BUSINESS_APP_URL || (!hosted(config) ? config.businessAppUrl : undefined)];
    for (const [index, code] of ['CUSTOMER_CALLBACK_INVALID', 'BUSINESS_CALLBACK_INVALID'].entries()) {
      if (!validCallback(callbackValues[index], hosted(config))) checks.push(check(code, 'fail'));
    }
    if (callbackValues.every(value => validCallback(value, hosted(config)))) {
      checks.push(check('CALLBACK_URLS_CONFIGURED', 'pass'));
      const origins = config.corsOrigins || (config.CORS_ORIGINS || '').split(',').map(value => value.trim());
      if (hosted(config) && !callbackValues.every(value => origins.includes(new URL(value).origin))) checks.push(check('CALLBACK_CORS_MISMATCH', 'fail'));
      if (config.APP_ROUTING_MODE !== 'subdomains' && (config.hostedDemo === true || config.HOSTED_DEMO === 'true')) {
        const [customer, business] = callbackValues.map(value => new URL(value));
        if (customer.origin !== business.origin || customer.pathname !== '/' || !['/app', '/app/'].includes(business.pathname)) {
          checks.push(check('HOSTED_DEMO_CALLBACK_ROUTING_MISMATCH', 'fail'));
        }
      }
    }
  } else if (mode === 'disabled') checks.push(check('PAYMENTS_DISABLED', 'pass'));
  if (config.STRIPE_SANDBOX_SHARED_ACCOUNT_ID) {
    const valid = sharedAllowed(config) && mode === 'test' && /^acct_[A-Za-z0-9]+$/.test(config.STRIPE_SANDBOX_SHARED_ACCOUNT_ID)
      && stripeServerKeyMode(config.STRIPE_SECRET_KEY) === 'test';
    checks.push(check(valid ? 'SHARED_SANDBOX_ROUTING' : 'SHARED_SANDBOX_ROUTING_FORBIDDEN', valid ? 'warn' : 'fail'));
  }
  try { validateStripeSettings(config); }
  catch { if (!checks.some(item => item.status === 'fail')) checks.push(check('STRIPE_CONFIGURATION_INVALID', 'fail')); }
  checks.push(check('KEY_PAIR_IDENTITY_NOT_VERIFIED', 'not-checked'), check('WEBHOOK_DELIVERY_NOT_VERIFIED', 'not-checked'));
  return { mode: checks.some(item => item.status === 'fail') ? 'configuration-blocked' : mode === 'live' ? 'live-ready' : mode === 'test' ? 'sandbox-ready' : 'disabled', checks };
}

function requiredPaymentSchema(models = {}) {
  const schema = Object.fromEntries(Object.entries(BASE_SCHEMA).map(([table, columns]) => [table, [...columns]]));
  for (const name of MODEL_NAMES) {
    const model = models[name];
    const tableName = model?.getTableName?.();
    const table = typeof tableName === 'string' ? tableName : tableName?.tableName;
    if (!schema[table]) continue;
    for (const [attribute, definition] of Object.entries(model.getAttributes?.() || model.rawAttributes || {})) {
      if (definition.type?.key !== 'VIRTUAL') schema[table].push(definition.field || attribute);
    }
    schema[table] = [...new Set(schema[table])];
  }
  return schema;
}

function reportBase(config, now) {
  const configuration = inspectPaymentConfiguration(config);
  return { scope: 'payment-preflight', mode: configuration.mode, checkedAt: now.toISOString(), checks: configuration.checks,
    schema: { status: 'not-checked', missingTableCount: 0, missingColumnCount: 0, missingMigrationCount: 0 },
    routing: { status: 'not-checked', activePaidEventCount: 0, readyEventCount: 0, blockedEventCount: 0, eventSpecificCount: 0, organizationDefaultCount: 0, sharedSandboxCount: 0 },
    workers: { status: 'not-checked', healthyWorkerCount: 0, matchingWorkerCount: 0, mismatchedWorkerCount: 0 },
    runtime: { revision: paymentRuntimeEvidence(config).revision },
    evidence: { keyPairIdentity: 'not-verified', webhookDelivery: 'not-verified', providerReadiness: 'stored-snapshot-only' } };
}

// Normalize every merchant fact before grouping: response work is independent
// of the number of events/accounts, never an event-by-event model/provider scan.
// The hard group limit also bounds pathological combinations of stored states.
const ROUTING_SQL = `WITH routes AS (
  SELECT CASE WHEN :sharedAccount IS NOT NULL THEN 'shared' WHEN e.payment_account_id IS NOT NULL THEN 'event' ELSE 'default' END AS source,
    (o.id IS NOT NULL AND o.status='active' AND o.lifecycle_state='active') AS organization_active,
    (a.id IS NOT NULL) AS account_present,
    (a.organization_id=e.organization_id OR :sharedAccount IS NOT NULL) AS account_owned,
    (merchant_org.id IS NOT NULL AND merchant_org.status='active' AND merchant_org.lifecycle_state='active') AS account_owner_active,
    (a.account_api_version='v2') AS api_v2, (a.lifecycle_state='active') AS lifecycle_active,
    (a.mode=:mode) AS mode_matches, (a.stripe_account_id IS NOT NULL AND a.stripe_account_id<>'') AS stripe_present,
    a.details_submitted, a.charges_enabled, a.card_payments_active, a.controller_matches,
    (a.payments_disabled_at IS NOT NULL) AS disabled, (a.disconnect_status IS NULL OR a.disconnect_status='none') AS disconnect_clear,
    CASE WHEN a.synchronized_at IS NULL THEN 'missing' WHEN a.synchronized_at>CAST(:observedAt AS timestamptz) THEN 'future'
      WHEN a.synchronized_at<CAST(:observedAt AS timestamptz)-INTERVAL '5 minutes' THEN 'stale' ELSE 'current' END AS freshness
  FROM events e LEFT JOIN organizations o ON o.id=e.organization_id
  LEFT JOIN payment_accounts a ON ((:sharedAccount IS NOT NULL AND a.stripe_account_id=:sharedAccount AND a.mode='test' AND a.lifecycle_state='active')
    OR (:sharedAccount IS NULL AND a.id=COALESCE(e.payment_account_id,o.default_payment_account_id)))
  LEFT JOIN organizations merchant_org ON merchant_org.id=a.organization_id
  WHERE e.status='published' AND e.lifecycle_state='active' AND e.ends_at>CAST(:observedAt AS timestamptz)
    AND EXISTS(SELECT 1 FROM offerings offering WHERE offering.event_id=e.id AND offering.is_active=true AND offering.price_cents>0)
) SELECT source, organization_active, account_present, account_owned, account_owner_active, api_v2, lifecycle_active, mode_matches, stripe_present,
  details_submitted, charges_enabled, card_payments_active, controller_matches, disabled, disconnect_clear, freshness,
  COUNT(*)::int AS event_count, SUM(COUNT(*)) OVER()::int AS total_event_count
FROM routes GROUP BY source, organization_active, account_present, account_owned, account_owner_active, api_v2, lifecycle_active, mode_matches, stripe_present,
  details_submitted, charges_enabled, card_payments_active, controller_matches, disabled, disconnect_clear, freshness LIMIT 129`;

function groupReady(group, observedAt, mode) {
  if (!group.organization_active || !group.account_present || !group.account_owned || !group.account_owner_active) return false;
  return paymentsReady({ accountApiVersion: group.api_v2 ? 'v2' : 'unsupported', lifecycleState: group.lifecycle_active ? 'active' : 'archived',
    mode: group.mode_matches ? mode : 'unsupported', stripeAccountId: group.stripe_present ? 'stored' : null,
    detailsSubmitted: group.details_submitted, chargesEnabled: group.charges_enabled, cardPaymentsActive: group.card_payments_active,
    controllerMatches: group.controller_matches, paymentsDisabledAt: group.disabled ? observedAt : null,
    disconnectStatus: group.disconnect_clear ? 'none' : 'pending',
    synchronizedAt: group.freshness === 'missing' ? null : new Date(+observedAt + (group.freshness === 'future' ? 1 : group.freshness === 'stale' ? -300001 : 0)),
  }, observedAt, mode);
}

async function inspectPaymentPreflight({ config = {}, sequelize, models = {}, stripe, now = () => new Date(), timeoutMs = 3000 }, { requirePaid = false, expectRevision = null } = {}) {
  const observedAt = now();
  const report = reportBase(config, observedAt);
  if (expectRevision) report.checks.push(check(report.runtime.revision === expectRevision ? 'RELEASE_REVISION_MATCH' : 'RELEASE_REVISION_MISMATCH', report.runtime.revision === expectRevision ? 'pass' : 'fail'));
  if (!isStripeMode(config.STRIPE_MODE)) {
    if (requirePaid) report.checks.push(check('PAYMENTS_DISABLED', 'fail'));
    report.mode = report.checks.some(item => item.status === 'fail') ? 'configuration-blocked' : 'disabled';
    return report;
  }
  if (stripe !== undefined && (!stripe || stripe.mode !== config.STRIPE_MODE || stripe.enabled !== true
    || (stripe.sandboxSharedAccountId || null) !== (config.STRIPE_SANDBOX_SHARED_ACCOUNT_ID || null))) report.checks.push(check('PAYMENT_RUNTIME_UNAVAILABLE', 'fail'));
  report.checks.push(check('PROVIDER_READINESS_SNAPSHOT_ONLY', 'warn'));
  try {
    await sequelize.transaction({ readOnly: true, isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
      const query = (sql, replacements = {}) => sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT, logging: false });
      const databaseTimeoutMs = Math.max(100, Math.min(10000, Math.floor(Number(timeoutMs) || 3000)));
      // Sequelize's readOnly option selects a read replica; PostgreSQL also
      // needs its own transaction flag to enforce the no-write boundary.
      await sequelize.query(`SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = ${databaseTimeoutMs}; SET LOCAL lock_timeout = ${Math.min(databaseTimeoutMs, 1000)}`, { transaction, logging: false });
      const required = requiredPaymentSchema(models);
      const columns = await query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN (:tables)', { tables: Object.keys(required) });
      const actual = new Map();
      for (const column of columns) {
        if (!actual.has(column.table_name)) actual.set(column.table_name, new Set());
        actual.get(column.table_name).add(column.column_name);
      }
      for (const [table, names] of Object.entries(required)) {
        if (!actual.has(table)) report.schema.missingTableCount++;
        else report.schema.missingColumnCount += names.filter(name => !actual.get(table).has(name)).length;
      }
      const migrationRows = actual.get('sequelize_meta')?.has('name')
        ? await query('SELECT name FROM sequelize_meta WHERE name IN (:migrations)', { migrations: REQUIRED_MIGRATIONS }) : [];
      const migrations = new Set(migrationRows.map(row => row.name));
      report.schema.missingMigrationCount = REQUIRED_MIGRATIONS.filter(name => !migrations.has(name)).length;
      const schemaReady = !report.schema.missingTableCount && !report.schema.missingColumnCount && !report.schema.missingMigrationCount;
      report.schema.status = schemaReady ? 'ready' : 'blocked';
      report.checks.push(check(schemaReady ? 'PAYMENT_SCHEMA_READY' : 'PAYMENT_SCHEMA_MISSING', schemaReady ? 'pass' : 'fail'));
      if (!schemaReady) return;

      const groups = await query(ROUTING_SQL, { mode: config.STRIPE_MODE, sharedAccount: config.STRIPE_SANDBOX_SHARED_ACCOUNT_ID || null, observedAt: observedAt.toISOString() });
      report.routing.activePaidEventCount = Number(groups[0]?.total_event_count || 0);
      if (groups.length > 128) {
        report.routing.status = 'unavailable';
        report.checks.push(check('PAYMENT_ROUTING_COMPLEXITY_LIMIT', 'fail'));
      } else {
        for (const group of groups) {
          const count = Number(group.event_count);
          report.routing[groupReady(group, observedAt, config.STRIPE_MODE) ? 'readyEventCount' : 'blockedEventCount'] += count;
          report.routing[group.source === 'event' ? 'eventSpecificCount' : group.source === 'shared' ? 'sharedSandboxCount' : 'organizationDefaultCount'] += count;
        }
        report.routing.status = report.routing.blockedEventCount ? 'blocked' : 'ready';
        report.checks.push(check(report.routing.blockedEventCount ? 'PAYMENT_ROUTING_BLOCKED' : 'PAYMENT_ROUTING_READY', report.routing.blockedEventCount ? 'fail' : 'pass'));
        if (!report.routing.activePaidEventCount) report.checks.push(check('PAID_ROUTES_MISSING', requirePaid ? 'fail' : 'warn'));
      }

      const runtime = paymentRuntimeEvidence(config);
      if (!runtime.revision) report.checks.push(check('RELEASE_REVISION_UNKNOWN', hosted(config) ? 'fail' : 'warn'));
      const [workers] = await query(`SELECT COUNT(*)::int AS healthy_count,
        COUNT(*) FILTER(WHERE details->>'paymentReconciliationEnabled'='true'
          AND :revision IS NOT NULL AND :fingerprint IS NOT NULL
          AND details->'paymentRuntime'->>'revision'=:revision
          AND details->'paymentRuntime'->>'configurationFingerprint'=:fingerprint)::int AS matching_count,
        COUNT(*) FILTER(WHERE NOT(COALESCE(details->>'paymentReconciliationEnabled'='true',false)
          AND :revision IS NOT NULL AND :fingerprint IS NOT NULL
          AND COALESCE(details->'paymentRuntime'->>'revision'=:revision,false)
          AND COALESCE(details->'paymentRuntime'->>'configurationFingerprint'=:fingerprint,false)))::int AS mismatched_count
        FROM background_workers WHERE status='running' AND heartbeat_at>CAST(:observedAt AS timestamptz)-INTERVAL '2 minutes'
          AND heartbeat_at<=CAST(:observedAt AS timestamptz)`, { revision: runtime.revision, fingerprint: runtime.configurationFingerprint, observedAt: observedAt.toISOString() });
      report.workers.healthyWorkerCount = Number(workers?.healthy_count || 0);
      report.workers.matchingWorkerCount = Number(workers?.matching_count || 0);
      report.workers.mismatchedWorkerCount = Number(workers?.mismatched_count || 0);
      const workersReady = report.workers.matchingWorkerCount > 0 && !report.workers.mismatchedWorkerCount;
      report.workers.status = workersReady ? 'ready' : 'blocked';
      report.checks.push(check(workersReady ? 'WORKER_RUNTIME_READY' : report.workers.mismatchedWorkerCount ? 'WORKER_RUNTIME_MISMATCH' : 'WORKER_RUNTIME_MISSING', workersReady ? 'pass' : hosted(config) || requirePaid || report.workers.mismatchedWorkerCount > 0 ? 'fail' : 'warn'));
    });
  } catch {
    report.schema.status = report.schema.status === 'not-checked' ? 'unavailable' : report.schema.status;
    report.routing.status = report.routing.status === 'not-checked' ? 'unavailable' : report.routing.status;
    report.workers.status = 'unavailable';
    report.checks.push(check('PAYMENT_DATABASE_UNAVAILABLE', 'fail'));
  }
  report.mode = report.checks.some(item => item.status === 'fail') ? 'configuration-blocked' : config.STRIPE_MODE === 'live' ? 'live-ready' : 'sandbox-ready';
  return report;
}

function createPaymentPreflight(dependencies) {
  let inFlight;
  async function inspect(options = {}) {
    // All requests share the same underlying observation. Request-specific
    // requirements are applied after that observation, never used as cache keys.
    if (!inFlight) {
      const running = inspectPaymentPreflight(dependencies);
      inFlight = running;
      const clear = () => { if (inFlight === running) inFlight = undefined; };
      running.then(clear, clear);
    }
    let timer;
    const deadline = new Promise(resolve => { timer = setTimeout(() => {
      const report = reportBase(dependencies.config || {}, (dependencies.now || (() => new Date()))());
      report.mode = 'configuration-blocked';
      report.schema.status = report.routing.status = report.workers.status = 'unavailable';
      report.checks.push(check('PAYMENT_DIAGNOSTIC_TIMEOUT', 'fail'));
      resolve(report);
    }, dependencies.timeoutMs ?? 3000); });
    try {
      const report = structuredClone(await Promise.race([inFlight, deadline]));
      if (options.requirePaid && (report.mode === 'disabled' || !report.routing.activePaidEventCount)) report.checks.push(check(report.mode === 'disabled' ? 'PAYMENTS_DISABLED' : 'PAID_ROUTES_MISSING', 'fail'));
      if (options.requirePaid && isStripeMode(dependencies.config?.STRIPE_MODE) && report.workers.status !== 'ready'
        && !report.checks.some(item => item.status === 'fail' && ['WORKER_RUNTIME_MISSING', 'WORKER_RUNTIME_MISMATCH'].includes(item.code))) {
        report.checks.push(check(report.workers.mismatchedWorkerCount ? 'WORKER_RUNTIME_MISMATCH' : 'WORKER_RUNTIME_MISSING', 'fail'));
      }
      if (options.expectRevision) report.checks.push(check(report.runtime.revision === options.expectRevision ? 'RELEASE_REVISION_MATCH' : 'RELEASE_REVISION_MISMATCH', report.runtime.revision === options.expectRevision ? 'pass' : 'fail'));
      if (report.checks.some(item => item.status === 'fail')) report.mode = 'configuration-blocked';
      return report;
    } finally { clearTimeout(timer); }
  }
  return { inspect };
}

module.exports = { createPaymentPreflight, inspectPaymentPreflight, inspectPaymentConfiguration, requiredPaymentSchema, REQUIRED_MIGRATIONS, CHECK_MESSAGES };
