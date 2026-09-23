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
});

function getConfig(environment = process.env) {
  const values = schema.parse(environment);
  if (values.HOSTED_DEMO === 'true' && (values.NODE_ENV !== 'production' || values.AUTH_TOKEN_SECRET === 'nitewide-development-secret-change-me')) {
    throw new Error('Hosted demo requires production runtime and a non-default signing secret');
  }
  return {
    ...values,
    hostedDemo: values.HOSTED_DEMO === 'true',
    databaseSsl: values.DATABASE_SSL === 'true',
    corsOrigins: values.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  };
}

module.exports = { getConfig };
