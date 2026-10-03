const path = require('node:path');
const { isolatedEnvironment, frontendBuildEnvironment } = require('./environment.cjs');
const { createCommandRunner } = require('../scripts/test-command.cjs');
const { createTimingCollector } = require('../scripts/test-timing.cjs');
const { inputFingerprint, isBuildFresh, recordBuild } = require('./build-freshness.cjs');
const root = path.resolve(__dirname, '..');
const frontendApps = ['customer', 'business', 'admin'];
const allowedProjects = new Set(['customer-iphone', 'customer-desktop', 'business-iphone', 'business-desktop', 'admin-rebuild-iphone', 'admin-rebuild-desktop']);
function validateArguments(args) {
  if (args.some(arg => /^(?:--config(?:=|$)|-c|--workers(?:=|$)|-j|--fully-parallel(?:=|$)|--repeat-each(?:=|$)|--output(?:=|$))/.test(arg))) {
    throw new Error('Use the fixed Playwright configuration and single worker. Custom targets or concurrent fixture resets are forbidden.');
  }
  return args;
}
function allowsLocalBuildReuse(args, source = process.env) {
  if (source.CI) return false;
  const projects = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--project') projects.push(args[++index]);
    else if (args[index].startsWith('--project=')) projects.push(args[index].slice('--project='.length));
  }
  return projects.length > 0 && projects.every(project => allowedProjects.has(project));
}
async function withRunner(operation, options = {}) {
  if (options.runner) return operation(options.runner, options.timing);
  const timing = createTimingCollector(options.timingScope || 'e2e-runner');
  const runner = createCommandRunner({ cwd: root, env: isolatedEnvironment('postgres://test:test@127.0.0.1:1/nitewide_unused'), timing });
  try { return await operation(runner, timing); }
  catch (error) { process.exitCode = runner.exitCode; throw error; }
  finally { runner.dispose(); timing.report(); }
}
async function run(command, args, options = {}) {
  const environment = options.buildFrontend ? frontendBuildEnvironment() : isolatedEnvironment('postgres://test:test@127.0.0.1:1/nitewide_unused');
  if (options.inventory) environment.PW_TEST_REPORTER = '';
  return withRunner(runner => runner.run(command, args, { env: environment,
    labels: options.labels || { suite: 'browser' } }), options);
}
async function build(options = {}) {
  return withRunner(async (runner, timing) => {
    const environment = frontendBuildEnvironment();
    for (const app of frontendApps) {
      const input = inputFingerprint(root, app, environment);
      if (options.allowReuse && !process.env.CI && isBuildFresh(root, app, input)) {
        console.log(`Browser build: ${app} unchanged; verified isolated production assets.`);
        timing.record('build', 0, { app, status: 'reused' });
        continue;
      }
      await timing.measure('build', () => runner.npm(['run', 'build', '--workspace', `@nitewide/${app}`], { env: environment,
        labels: { suite: 'browser-build', app } }), { app, status: 'fresh' });
      // Do not certify a build if its inputs changed while Vite was running.
      if (input === inputFingerprint(root, app, environment)) recordBuild(root, app, input);
    }
  }, options);
}
async function main(args = process.argv.slice(2), options = {}) {
  validateArguments(args);
  const listing = args.includes('--list');
  if (listing && args.some(arg => /^--add-reporter(?:=|$)/.test(arg))) {
    throw new Error('Browser inventory uses only its console reporter; additional reporters may overwrite verification artifacts.');
  }
  const inventory = listing || args.includes('--help') || args.includes('-h');
  return withRunner(async (runner, timing) => {
    // Playwright --list loads specs without starting webServer or a database.
    if (!inventory) await build({ runner, timing, allowReuse: allowsLocalBuildReuse(args) });
    // The configured HTML/JUnit/timing reporters otherwise treat a listing as
    // an all-skipped run and overwrite the last real verification artifacts.
    const argumentsForCli = listing ? [...args, '--reporter=list'] : args;
    await timing.measure('test', () => run(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...argumentsForCli], { runner, timing, inventory: listing }), { suite: listing ? 'browser-list' : 'browser' });
  }, { ...options, timingScope: inventory ? 'browser-inventory' : options.timingScope });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode ||= 1; });
module.exports = { run, build, validateArguments, allowsLocalBuildReuse, frontendApps, allowedProjects, main };
