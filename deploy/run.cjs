// Regular releases use independent API/worker processes. No demo seeding or
// supervisor is imported here; deploy/start.cjs remains demo-only.
const { getConfig } = require('../apps/api/src/config');

function releaseConfig(environment = process.env) {
  if (!['staging', 'production'].includes(environment.APP_ENVIRONMENT)) {
    throw new Error('Release startup requires APP_ENVIRONMENT=staging or production');
  }
  if (environment.HOSTED_DEMO !== 'false' || environment.DEMO_RESEED_GENERATION) {
    throw new Error('Demo mode and reseeding are forbidden in release startup');
  }
  const config = getConfig(environment);
  if (!config.RELEASE_REVISION) throw new Error('Release startup requires a verified commit revision');
  return config;
}

async function verifyMediaAccess(config, { createStorage = require('../apps/api/src/storage/media-storage').createR2Storage,
  log = console.log, errorLog = console.error } = {}) {
  const storage = createStorage({ config });
  try {
    await storage.checkAccess();
    log(JSON.stringify({ event: 'release_media_access_checked', environment: config.APP_ENVIRONMENT,
      revision: config.RELEASE_REVISION, provider: 'r2' }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const reason = status === 401 || status === 403 ? 'access_denied' : status === 404 ? 'bucket_not_found'
      : ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'storage_unavailable';
    // Never log provider messages, URLs, headers, signatures, or credentials.
    errorLog(JSON.stringify({ event: 'release_media_access_failed', environment: config.APP_ENVIRONMENT, provider: 'r2', reason }));
    throw new Error('Release R2 access check failed; verify this environment\'s bucket-scoped S3 credentials');
  } finally { storage.close(); }
}

async function main(args = process.argv.slice(2), environment = process.env, dependencies = {}) {
  if (args.length !== 1 || !['api', 'worker', 'check', 'check-media', 'migrate'].includes(args[0])) {
    throw new Error('Use deploy/run.cjs api, worker, check, check-media, or migrate');
  }
  const config = releaseConfig(environment);
  const role = args[0];
  if (role === 'check') {
    (dependencies.log || console.log)(JSON.stringify({ event: 'release_configuration_checked', environment: config.APP_ENVIRONMENT,
      revision: config.RELEASE_REVISION, stripeMode: config.STRIPE_MODE }));
    return config;
  }
  if (['api', 'worker'].includes(role) && (role === 'api') !== config.serveFrontends) {
    throw new Error('API must enable SERVE_FRONTENDS; the independent worker must disable it');
  }
  // Check credentials in each runtime, including service-level overrides. The
  // migration pre-deploy fails before DB writes; API/worker fail before serving.
  await (dependencies.verifyMediaAccess || verifyMediaAccess)(config);
  if (role === 'check-media') return config;
  if (role === 'migrate') return (dependencies.migrate || require('./migrate.cjs').migrate)(config);
  if (dependencies.startRuntime) return dependencies.startRuntime(role, config);
  return require(`../apps/api/src/${role === 'api' ? 'server' : 'worker'}`).main();
}

if (require.main === module) main().catch(() => {
  // Validation errors can include values. Keep release logs credential-free.
  console.error(JSON.stringify({ event: 'release_startup_failed', outcome: 'error' }));
  process.exitCode = 1;
});
module.exports = { releaseConfig, verifyMediaAccess, main };
