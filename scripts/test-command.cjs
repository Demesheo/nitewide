const { spawn } = require('node:child_process');
const path = require('node:path');
// CI measures npm installation before node_modules exists. Explicit-env
// bootstrap commands must load only built-ins; application-test defaults load
// the isolation helper lazily after dependencies have been installed.
const offlineEnvironment = (...args) => require('../apps/api/scripts/test-database.cjs').offlineEnvironment(...args);

const root = path.resolve(__dirname, '..');
function quickEnvironment(source = process.env) {
  return { ...offlineEnvironment(source), DATABASE_URL: 'postgres://test:test@127.0.0.1:1/nitewide_unit_no_database',
    TEST_DATABASE_URL: '', TEST_DATABASE_MANAGED: '', RUN_DB_TESTS: '', RUN_ORLANDO_SEED_TESTS: '' };
}

function createCommandRunner({ cwd = root, env = offlineEnvironment(), timing,
  spawnChild = spawn, signalSource = process, killGroup = process.kill.bind(process), platform = process.platform,
  schedule = setTimeout, cancelSchedule = clearTimeout, warn = message => process.stderr.write(message + '\n') } = {}) {
  const active = new Set();
  const deadlines = new Map();
  let interrupted = null;
  const finish = handle => { active.delete(handle); if (deadlines.has(handle)) cancelSchedule(deadlines.get(handle)); deadlines.delete(handle); };
  const stop = signal => {
    interrupted ||= signal;
    for (const handle of active) {
      if (!handle.pid) continue;
      try {
        if (platform === 'win32') handle.kill('SIGTERM');
        else killGroup(-handle.pid, 'SIGTERM');
      } catch (error) { if (error.code !== 'ESRCH') warn('Could not stop a test command process group.'); }
      if (!deadlines.has(handle)) {
        const deadline = schedule(() => {
          if (!active.has(handle)) return;
          warn('Test command did not stop after 30 seconds; forcing its remaining process group to stop. Check the generated test database cleanup diagnostics.');
          try {
            if (platform === 'win32') handle.kill('SIGKILL');
            else killGroup(-handle.pid, 'SIGKILL');
          } catch (error) { if (error.code !== 'ESRCH') warn('Could not force the test command process group to stop.'); }
        }, 30000);
        deadline.unref?.(); deadlines.set(handle, deadline);
      }
    }
  };
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  signalSource.on('SIGINT', interrupt); signalSource.on('SIGTERM', terminate);
  function run(command, args, { env: commandEnvironment = env, capture = false, labels = {} } = {}) {
    const operation = () => {
      if (interrupted) return Promise.reject(new Error('Test command interrupted.'));
      return new Promise((resolve, reject) => {
        const handle = spawnChild(command, args, { cwd, env: commandEnvironment,
          stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', detached: platform !== 'win32' });
        active.add(handle);
        let stdout = '';
        if (capture) {
          handle.stdout.on('data', chunk => { stdout += chunk.toString(); });
          // Diagnostics must not echo caller environment or database targets.
          handle.stderr.on('data', () => {});
        }
        handle.once('error', error => { finish(handle); reject(error); });
        handle.once('close', (code, signal) => {
          finish(handle);
          if (code === 0 && !interrupted) resolve(capture ? stdout : undefined);
          else reject(new Error(interrupted || signal ? 'Test command interrupted.' : `Test command failed (status ${code ?? 1}).`));
        });
      });
    };
    return timing ? timing.measure('command', operation, labels) : operation();
  }
  return { run,
    npm: (args, options) => run(platform === 'win32' ? 'npm.cmd' : 'npm', args, options),
    get interrupted() { return interrupted; },
    get exitCode() { return interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1; },
    dispose() { signalSource.removeListener('SIGINT', interrupt); signalSource.removeListener('SIGTERM', terminate); },
  };
}

module.exports = { root, quickEnvironment, createCommandRunner };
