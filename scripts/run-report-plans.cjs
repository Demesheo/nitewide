#!/usr/bin/env node
const { createCommandRunner, quickEnvironment } = require('./test-command.cjs');
const { createTimingCollector } = require('./test-timing.cjs');

async function runReportPlans({ runner, timing, environment = process.env }) {
  // The managed runner replaces this closed database fallback with its fresh
  // loopback clone. Ambient app URLs and provider credentials never reach tests.
  const env = { ...quickEnvironment(environment), NITEWIDE_TEST_QUERY_PLANS: '1' };
  await timing.measure('test', () => runner.run(process.execPath, [
    'apps/api/scripts/run-tests.cjs', '--integration', '--suite', 'report-export-integration.test.js',
  ], { env, labels: { suite: 'report-query-plans', app: 'api' } }), { suite: 'report-query-plans', app: 'api' });
}

async function main(args = process.argv.slice(2)) {
  if (args.length) throw new Error('test:api:plans accepts no filters; it profiles the complete isolated reporting/export suite.');
  const timing = createTimingCollector('report-plans');
  const runner = createCommandRunner({ timing });
  try { await runReportPlans({ runner, timing }); }
  catch (error) { process.exitCode = runner.exitCode; throw error; }
  finally { runner.dispose(); timing.report(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode ||= 1; });
module.exports = { runReportPlans, main };
