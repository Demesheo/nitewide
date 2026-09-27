const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/nitewide'),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  MEDIA_UPLOAD_DIR: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:5175'),
  AUTH_TOKEN_SECRET: z.string().min(32).default('nitewide-development-secret-change-me'),
  HOSTED_DEMO: z.enum(['true', 'false']).default('false'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_TEST_MODE: z.enum(['true', 'false']).default('false'),
  CUSTOMER_APP_URL: z.string().url().default('http://localhost:5173'),
  BUSINESS_APP_URL: z.string().url().optional(),
  BUSINESS_GUESTLIST_REVIEW_EMAILS: z.enum(['true', 'false']).default('false'),
});

function getConfig(environment = process.env) {
  const values = schema.parse(environment);
  if (values.HOSTED_DEMO === 'true' && (values.NODE_ENV !== 'production' || values.AUTH_TOKEN_SECRET === 'nitewide-development-secret-change-me')) {
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
    hostedDemo: values.HOSTED_DEMO === 'true',
    databaseSsl: values.DATABASE_SSL === 'true',
    resendTestMode: values.RESEND_TEST_MODE === 'true',
    businessAppUrl,
    businessGuestlistReviewEmails: values.BUSINESS_GUESTLIST_REVIEW_EMAILS === 'true',
    corsOrigins: values.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  };
}

module.exports = { getConfig };
