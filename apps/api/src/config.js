const { z } = require('zod');
const { databaseConnectionConfig } = require('./db/connection-config');

const DEVELOPMENT_SECRETS = {
  AUTH_TOKEN_SECRET: 'nitewide-development-secret-change-me',
  QR_TOKEN_SECRET: 'nitewide-development-qr-secret-change-me',
  EMAIL_ENCRYPTION_KEY: 'nitewide-development-email-key-change-me',
};
const SECRET_NAMES = Object.keys(DEVELOPMENT_SECRETS);
const optionalR2 = validator => z.preprocess(value => value === '' ? undefined : value, validator.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  BIND_HOST: z.enum(['127.0.0.1', '0.0.0.0']).optional(),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/nitewide'),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900000).default(120000),
  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(10000),
  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900000).default(120000),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(10000),
  DATABASE_ACQUIRE_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info']).optional(),
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(3000),
  API_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  MEDIA_UPLOAD_DIR: z.string().optional(),
  MEDIA_STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  R2_ACCOUNT_ID: optionalR2(z.string().regex(/^[a-f0-9]{32}$/i)),
  R2_BUCKET: optionalR2(z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)),
  R2_ACCESS_KEY_ID: optionalR2(z.string().min(16)),
  R2_SECRET_ACCESS_KEY: optionalR2(z.string().min(32)),
  R2_ENDPOINT: optionalR2(z.string().url()),
  R2_READ_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  MEDIA_CLEANUP_ENABLED: z.enum(['true', 'false']).default('false'),
  MEDIA_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(60000).max(86400000).default(3600000),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:5175'),
  AUTH_TOKEN_SECRET: z.string().min(32).optional(),
  QR_TOKEN_SECRET: z.string().min(32).optional(),
  EMAIL_ENCRYPTION_KEY: z.string().min(32).optional(),
  HOSTED_DEMO: z.enum(['true', 'false']).default('false'),
  STRIPE_MODE: z.enum(['disabled', 'test']).default('disabled'),
  STRIPE_SECRET_KEY: optionalR2(z.string()),
  STRIPE_PUBLISHABLE_KEY: optionalR2(z.string()),
  STRIPE_WEBHOOK_SECRET: optionalR2(z.string()),
  STRIPE_ACCOUNT_WEBHOOK_SECRET: optionalR2(z.string()),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  RESEND_TEST_MODE: z.enum(['true', 'false']).default('false'),
  CUSTOMER_APP_URL: z.string().url().default('http://localhost:5173'),
  BUSINESS_APP_URL: z.string().url().optional(),
  BUSINESS_GUESTLIST_REVIEW_EMAILS: z.enum(['true', 'false']).default('false'),
  EMAIL_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  EMAIL_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  EMAIL_REQUEST_INTERVAL_MS: z.coerce.number().int().min(500).max(5000).default(600),
  NOTIFICATION_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  EXPORT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(2000),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(10000).max(300000).default(150000),
});

function getConfig(environment = process.env) {
  const values = schema.parse(environment);
  // Live mode is deliberately not a configuration option in this integration.
  // Validate even disabled credentials so a live key cannot slip in unnoticed.
  if (values.STRIPE_SECRET_KEY && !/^sk_test_[A-Za-z0-9]+$/.test(values.STRIPE_SECRET_KEY)) {
    throw new Error('STRIPE_SECRET_KEY must be a sandbox sk_test_ key; live payments are disabled');
  }
  if (values.STRIPE_PUBLISHABLE_KEY && !/^pk_test_[A-Za-z0-9]+$/.test(values.STRIPE_PUBLISHABLE_KEY)) {
    throw new Error('STRIPE_PUBLISHABLE_KEY must be a sandbox pk_test_ key');
  }
  for (const name of ['STRIPE_WEBHOOK_SECRET', 'STRIPE_ACCOUNT_WEBHOOK_SECRET']) {
    if (values[name] && !/^whsec_[A-Za-z0-9]+$/.test(values[name])) throw new Error(`${name} must be a Stripe webhook signing secret`);
  }
  if (values.STRIPE_MODE === 'test' && !values.STRIPE_SECRET_KEY) {
    throw new Error('Stripe test mode requires STRIPE_SECRET_KEY');
  }
  if (values.MEDIA_STORAGE_DRIVER === 'r2') {
    for (const key of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
      if (!values[key]) throw new Error(`R2 storage requires ${key}`);
    }
  }
  if (values.R2_ENDPOINT) {
    const allowed = values.R2_ACCOUNT_ID && new RegExp(`^https://${values.R2_ACCOUNT_ID}(?:\\.(?:eu|us|fedramp))?\\.r2\\.cloudflarestorage\\.com/?$`, 'i');
    if (!allowed || !allowed.test(values.R2_ENDPOINT)) throw new Error('R2_ENDPOINT must be the HTTPS Cloudflare R2 endpoint for R2_ACCOUNT_ID');
  }
  if (values.MEDIA_CLEANUP_ENABLED === 'true' && values.MEDIA_STORAGE_DRIVER !== 'r2') {
    throw new Error('Automatic media cleanup requires R2; local files are not shared across instances');
  }
  for (const name of SECRET_NAMES) {
    if (values.NODE_ENV === 'production' && (!values[name] || Object.values(DEVELOPMENT_SECRETS).includes(values[name]) || /replace[-_ ]?this|change[-_ ]?me|your[-_ ]?(secret|key)/i.test(values[name]))) {
      throw new Error(`Production requires an explicit, non-default ${name} (at least 32 characters)`);
    }
    values[name] ||= DEVELOPMENT_SECRETS[name];
  }
  if (new Set(SECRET_NAMES.map(name => values[name])).size !== SECRET_NAMES.length) {
    throw new Error('AUTH_TOKEN_SECRET, QR_TOKEN_SECRET and EMAIL_ENCRYPTION_KEY must be different keys');
  }
  const database = databaseConnectionConfig(environment);
  if (values.NODE_ENV !== 'production' && values.BIND_HOST === '0.0.0.0') {
    throw new Error('BIND_HOST=0.0.0.0 is reserved for production; local API binds to 127.0.0.1');
  }
  if (values.HOSTED_DEMO === 'true' && values.NODE_ENV !== 'production') {
    throw new Error('Hosted demo requires production runtime and a non-default signing secret');
  }
  if (Boolean(values.RESEND_API_KEY) !== Boolean(values.RESEND_FROM_EMAIL)) {
    throw new Error('RESEND_API_KEY and RESEND_FROM_EMAIL must be configured together');
  }
  if (values.RESEND_TEST_MODE === 'true') {
    const sender = values.RESEND_FROM_EMAIL?.match(/<([^>]+)>\s*$/)?.[1] || values.RESEND_FROM_EMAIL;
    if (values.NODE_ENV !== 'development' || !values.RESEND_API_KEY || sender?.toLowerCase() !== 'onboarding@resend.dev') {
      throw new Error('Resend test mode requires a development runtime, API key, and onboarding@resend.dev sender');
    }
  }
  if (values.RESEND_API_KEY && values.NODE_ENV === 'production' && !values.CUSTOMER_APP_URL.startsWith('https://')) {
    throw new Error('Production transactional email requires an HTTPS CUSTOMER_APP_URL');
  }
  const businessAppUrl = values.BUSINESS_APP_URL || (values.HOSTED_DEMO === 'true' ? new URL('/app', values.CUSTOMER_APP_URL).toString() : 'http://localhost:5174/app');
  if (values.RESEND_API_KEY && values.NODE_ENV === 'production' && !businessAppUrl.startsWith('https://')) {
    throw new Error('Production transactional email requires an HTTPS BUSINESS_APP_URL');
  }
  return {
    ...values,
    LOG_LEVEL: values.LOG_LEVEL || (values.NODE_ENV === 'test' ? 'silent' : 'info'),
    bindHost: values.BIND_HOST || (values.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    hostedDemo: values.HOSTED_DEMO === 'true',
    trustProxy: values.TRUST_PROXY_HOPS ?? (values.HOSTED_DEMO === 'true' ? 1 : false),
    ...database,
    DATABASE_URL: database.databaseUrl,
    resendTestMode: values.RESEND_TEST_MODE === 'true',
    businessAppUrl,
    businessGuestlistReviewEmails: values.BUSINESS_GUESTLIST_REVIEW_EMAILS === 'true',
    corsOrigins: values.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  };
}

module.exports = { getConfig, DEVELOPMENT_SECRETS, SECRET_NAMES };
