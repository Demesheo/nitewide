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

async function main(args = process.argv.slice(2), environment = process.env) {
  if (args.length !== 1 || !['api', 'worker', 'check', 'migrate'].includes(args[0])) {
    throw new Error('Use deploy/run.cjs api, worker, check, or migrate');
  }
  const config = releaseConfig(environment);
  const role = args[0];
  if (role === 'check') {
    console.log(JSON.stringify({ event: 'release_configuration_checked', environment: config.APP_ENVIRONMENT,
      revision: config.RELEASE_REVISION, stripeMode: config.STRIPE_MODE }));
    return config;
  }
  if (role === 'migrate') return require('./migrate.cjs').migrate(config);
  if ((role === 'api') !== config.serveFrontends) {
    throw new Error('API must enable SERVE_FRONTENDS; the independent worker must disable it');
  }
  return require(`../apps/api/src/${role === 'api' ? 'server' : 'worker'}`).main();
}

if (require.main === module) main().catch(() => {
  // Validation errors can include values. Keep release logs credential-free.
  console.error(JSON.stringify({ event: 'release_startup_failed', outcome: 'error' }));
  process.exitCode = 1;
});
module.exports = { releaseConfig, main };
