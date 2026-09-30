const { z } = require('zod');
const { databaseConnectionConfig } = require('./db/connection-config');

const DEVELOPMENT_SECRETS = {
  AUTH_TOKEN_SECRET: 'nitewide-development-secret-change-me',
  QR_TOKEN_SECRET: 'nitewide-development-qr-secret-change-me',
  EMAIL_ENCRYPTION_KEY: 'nitewide-development-email-key-change-me',
};
const SECRET_NAMES = Object.keys(DEVELOPMENT_SECRETS);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  BIND_HOST: z.enum(['127.0.0.1', '0.0.0.0']).optional(),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/nitewide'),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  MEDIA_UPLOAD_DIR: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:5175'),
  AUTH_TOKEN_SECRET: z.string().min(32).optional(),
  QR_TOKEN_SECRET: z.string().min(32).optional(),
  EMAIL_ENCRYPTION_KEY: z.string().min(32).optional(),
  HOSTED_DEMO: z.enum(['true', 'false']).default('false'),
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
