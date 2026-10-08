const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createProcessSupervisor } = require('../apps/api/scripts/test-process-supervisor.cjs');
const { createTimingCollector } = require('./test-timing.cjs');
const { phasePlan } = require('./time-test-phase.cjs');

const root = path.resolve(__dirname, '..');
const phaseTimeouts = Object.freeze({ 'npm-version': 120000, dependencies: 300000, 'browser-pull': 300000 });

// Validate from checked-in metadata before either branch starts. This module
// and its helpers use only built-ins: npm ci has not installed packages yet.
function bootstrapPlan({ source = process.env, workspace = root, nodeVersion = process.versions.node,
  read = filename => fs.readFileSync(filename, 'utf8') } = {}) {
  const expectedNode = read(path.join(workspace, '.nvmrc')).trim();
  const manifest = JSON.parse(read(path.join(workspace, 'package.json')));
  const lock = JSON.parse(read(path.join(workspace, 'package-lock.json')));
  if (expectedNode !== '24.21.0' || nodeVersion !== expectedNode) throw new Error('CI browser bootstrap requires Node 24.21.0.');
  if (manifest.packageManager !== 'npm@12.1.0') throw new Error('CI browser bootstrap requires the npm@12.1.0 package manager pin.');
  const version = lock.packages?.['node_modules/@playwright/test']?.version;
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || manifest.devDependencies?.['@playwright/test'] !== version
    || lock.packages?.['']?.devDependencies?.['@playwright/test'] !== version) {
    throw new Error('CI browser bootstrap requires matching exact Playwright package and lockfile pins.');
  }
  if (source.PLAYWRIGHT_CONTAINER_IMAGE !== `mcr.microsoft.com/playwright:v${version}-noble`) {
    throw new Error('CI browser bootstrap image must match the locked Playwright version.');
  }
  return Object.fromEntries(Object.keys(phaseTimeouts).map(phase => [phase, phasePlan(phase, source)]));
}

async function runBrowserBootstrap({ source = process.env, workspace = root, nodeVersion = process.versions.node,
  read, timing = createTimingCollector('ci-setup', { environment: source }), spawnProcess = spawn,
  signalSource = process, schedule = setTimeout, cancelSchedule = clearTimeout,
  terminationGraceMillis = 5000, killGraceMillis = 5000 } = {}) {
  let failure = null;
  let cleanupFailure = null;
  let interrupted = null;
  let shutdown = null;
  let supervisor;
  let versionOutput = '';
  const stop = error => {
    failure ||= error;
    if (supervisor && !shutdown) {
      shutdown = supervisor.stop(error);
      // Signals and timeout callbacks cannot await. Consume their rejection
      // immediately, then rethrow it after both branches have been drained.
      shutdown.catch(error => { cleanupFailure = error; });
    }
  };
  const signals = ['SIGINT', 'SIGTERM'];
  const handlers = signals.map(signal => () => {
    interrupted ||= signal;
    stop(new Error(`CI browser bootstrap interrupted by ${signal}.`));
  });
  try {
    const plan = bootstrapPlan({ source, workspace, nodeVersion, read });
    supervisor = createProcessSupervisor({ cwd: workspace, terminationGraceMillis, killGraceMillis,
      spawnProcess(command, args, options) {
        const versionCheck = command === 'npm' && args.length === 1 && args[0] === '--version';
        const child = spawnProcess(command, args, versionCheck ? { ...options, stdio: ['ignore', 'pipe', 'inherit'] } : options);
        if (versionCheck) child.stdout.on('data', chunk => {
          versionOutput += chunk.toString();
          if (versionOutput.length > 1024) stop(new Error('CI npm version check returned unexpected output.'));
        });
        child.once('error', error => stop(error));
        // React at exit/error, before close waits for any remaining descendants.
        // The supervisor retains each detached process group until it drains.
        child.once('exit', (status, signal) => {
          if (status !== 0) stop(new Error(signal ? `CI bootstrap command interrupted by ${signal}.` : `CI bootstrap command exited with status ${status}.`));
        });
        return child;
      },
    });
    signals.forEach((signal, index) => signalSource.on(signal, handlers[index]));
    const phase = (name, operation) => timing.measure(`ci.${name}`, async () => {
      const deadline = schedule(() => stop(new Error(`CI ${name} exceeded its ${phaseTimeouts[name] / 60000}-minute limit.`)), phaseTimeouts[name]);
      try {
        if (failure) throw failure;
        await operation();
        if (failure) throw failure;
      } catch (error) { stop(error); throw error; }
      finally { cancelSchedule(deadline); }
    });
    const dependencies = async () => {
      await phase('npm-version', async () => {
        await supervisor.run(...plan['npm-version'], source);
        await supervisor.run('npm', ['--version'], source);
        if (versionOutput.trim() !== '12.1.0') throw new Error('CI browser bootstrap requires installed npm 12.1.0.');
      });
      await phase('dependencies', () => supervisor.run(...plan.dependencies, source));
    };
    const results = await Promise.allSettled([
      dependencies(),
      phase('browser-pull', () => supervisor.run(...plan['browser-pull'], source)),
    ]);
    for (const result of results) if (result.status === 'rejected') stop(result.reason);
    if (shutdown) {
      try { await shutdown; } catch (error) { cleanupFailure = error; }
    }
    if (cleanupFailure) failure = new AggregateError([failure, cleanupFailure], `${failure.message}\n${cleanupFailure.message}`);
    if (failure) {
      if (interrupted) failure.exitCode = interrupted === 'SIGINT' ? 130 : 143;
      throw failure;
    }
  } finally {
    signals.forEach((signal, index) => signalSource.removeListener(signal, handlers[index]));
    // One collector owns all overlapping phases. Separate reporting processes
    // would race the ci-setup report's read/merge/write cycle.
    timing.report();
  }
}

if (require.main === module) {
  if (process.argv.length !== 2) { console.error('CI browser bootstrap accepts no arguments.'); process.exitCode = 1; }
  else runBrowserBootstrap().catch(error => { console.error(error.message); process.exitCode = error.exitCode || 1; });
}

module.exports = { bootstrapPlan, phaseTimeouts, runBrowserBootstrap };
