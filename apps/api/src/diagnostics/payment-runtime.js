const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { STRIPE_API_VERSION } = require('../payments/stripe-client');

const REVISION = /^[a-f0-9]{40}$/;
function releaseRevision(environment = process.env, read = fs.readFileSync) {
  // Image metadata is authoritative over an operator-provided environment
  // value. Native Git deploys have no baked file and use Render's commit.
  try {
    const embedded = JSON.parse(read(path.resolve(__dirname, '../../release.json'), 'utf8'));
    return REVISION.test(embedded.revision || '') ? embedded.revision : null;
  } catch (error) {
    if (error.code !== 'ENOENT') return null;
    return REVISION.test(environment.RENDER_GIT_COMMIT || '') ? environment.RENDER_GIT_COMMIT : null;
  }
}

function paymentRuntimeEvidence(config = {}) {
  const revision = REVISION.test(config.RELEASE_REVISION || '') ? config.RELEASE_REVISION : null;
  if (typeof config.AUTH_TOKEN_SECRET !== 'string' || config.AUTH_TOKEN_SECRET.length < 32) {
    return { revision, configurationFingerprint: null };
  }
  const origins = [...new Set(config.corsOrigins || (config.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean))].sort();
  const settings = {
    version: 3, apiVersion: STRIPE_API_VERSION,
    environment: config.NODE_ENV || null, hostedDemo: config.hostedDemo === true || config.HOSTED_DEMO === 'true',
    mode: config.STRIPE_MODE || 'disabled',
    secretKey: config.STRIPE_SECRET_KEY || null, publishableKey: config.STRIPE_PUBLISHABLE_KEY || null,
    paymentWebhookSecret: config.STRIPE_WEBHOOK_SECRET || null, accountWebhookSecret: config.STRIPE_ACCOUNT_WEBHOOK_SECRET || null,
    connectClientId: config.STRIPE_CONNECT_CLIENT_ID || null, sharedAccount: config.STRIPE_SANDBOX_SHARED_ACCOUNT_ID || null,
    customerUrl: config.CUSTOMER_APP_URL || null, businessUrl: config.businessAppUrl || config.BUSINESS_APP_URL || null,
    routingMode: config.APP_ROUTING_MODE || 'paths', adminUrl: config.ADMIN_APP_URL || null,
    proxyMode: config.TRUST_PROXY_MODE || null, proxyHops: config.trustProxy ?? config.TRUST_PROXY_HOPS ?? null,
    corsOrigins: origins,
  };
  // A keyed comparison token, never the raw settings or a plain secret hash.
  // It is stored only in the existing private worker heartbeat. Do not log it.
  const configurationFingerprint = createHmac('sha256', config.AUTH_TOKEN_SECRET)
    .update('nitewide-payment-runtime-v1\0').update(JSON.stringify(settings)).digest('hex');
  return { revision, configurationFingerprint };
}

module.exports = { releaseRevision, paymentRuntimeEvidence };
