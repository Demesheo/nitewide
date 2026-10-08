const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { bootstrapPlan, phaseTimeouts, runBrowserBootstrap } = require('../../../scripts/ci-browser-bootstrap.cjs');
const { createTimingCollector } = require('../../../scripts/test-timing.cjs');

const root = path.resolve(__dirname, '../../..');
const image = 'mcr.microsoft.com/playwright:v1.63.0-noble';
const environment = () => ({ CI: 'true', NODE_ENV: 'test', PLAYWRIGHT_CONTAINER_IMAGE: image,
  TEST_DATABASE_ADMIN_URL: 'postgres://postgres:isolated-pg18-password@127.0.0.1:5434/postgres' });

// These fixtures execute only Node and IPC. No npm installation, Docker, port,
// browser, database, external request or provider credential is involved.
const fixture = String.raw`
const { spawn } = require('node:child_process');
const config = JSON.parse(process.argv[1]);
if (config.name === 'npm-check') {
  process.stdout.write(config.version + '\n');
  process.exit(0);
}
let descendant;
let stopping = false;
function ready() { process.send({ kind: 'ready', name: config.name, pid: process.pid, descendant: descendant?.pid }); }
function stop() {
  if (stopping) return;
  stopping = true;
  process.send({ kind: 'term', name: config.name });
  if (config.ignoreTerm || config.holdDrain) return;
  if (descendant) descendant.once('close', () => process.exit(0));
  else process.exit(0);
}
process.on('SIGTERM', stop);
process.on('message', message => {
  if (message === 'success') process.exit(0);
  if (message === 'failure') process.exit(23);
  if (message === 'drain') {
    if (descendant) { descendant.once('close', () => process.exit(0)); descendant.send('drain'); }
    else process.exit(0);
  }
});
if (config.descendant) {
  descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.on('message', message => { if (message === 'drain') process.exit(0); }); process.send('ready');"],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  descendant.once('message', ready);
} else ready();
`;

function commandName(command, args) {
  if (command === 'npm') {
    if (args.join(' ') === 'install --global npm@12.1.0') return 'npm-version';
    if (args.join(' ') === '--version') return 'npm-check';
    if (args.join(' ') === 'ci') return 'dependencies';
  }
  if (command === 'docker' && args.join(' ') === `pull ${image}`) return 'browser-pull';
  assert.fail(`Unexpected bootstrap command: ${command} ${args.join(' ')}`);
}

function harness(t, settings = {}) {
  const signalSource = new EventEmitter();
  const children = new Map();
  const calls = [];
  const messages = [];
  const events = new EventEmitter();
  const deadlines = new Map();
  const cancelled = [];
  let report;
  let reports = 0;
  let settled = false;
  const timing = createTimingCollector('ci-setup', { environment: environment(), read: () => null,
    write: (_filename, value) => { report = value; reports += 1; }, output() {} });
  const options = { source: environment(), workspace: root, nodeVersion: '24.21.0', timing, signalSource,
    terminationGraceMillis: settings.terminationGraceMillis ?? 3000, killGraceMillis: 3000,
    schedule(callback, milliseconds) { const handle = { callback, milliseconds }; deadlines.set(milliseconds, handle); return handle; },
    cancelSchedule(handle) { cancelled.push(handle); },
    spawnProcess(command, args, options) {
      const name = commandName(command, args);
      calls.push(name);
      assert.equal(options.detached, true);
      assert.deepEqual(options.env, environment());
      const child = spawn(process.execPath, ['-e', fixture, JSON.stringify({ name, version: settings.version || '12.1.0', ...settings[name] })],
        { ...options, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      children.set(name, child);
      child.on('message', message => { messages.push(message); events.emit('message', message); });
      child.on('close', (code, signal) => { messages.push({ kind: 'close', name, code, signal }); events.emit('message'); });
      return child;
    },
  };
  const running = runBrowserBootstrap(options);
  running.then(() => { settled = true; }, () => { settled = true; });
  async function wait(name, kind = 'ready') {
    const existing = () => messages.find(message => message.name === name && message.kind === kind);
    if (existing()) return existing();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { events.removeListener('message', check); reject(new Error(`Fixture did not reach ${name}:${kind}.`)); }, 5000);
      function check() { const result = existing(); if (result) { clearTimeout(timer); events.removeListener('message', check); resolve(result); } }
      events.on('message', check);
    });
  }
  t.after(async () => {
    signalSource.emit('SIGTERM');
    for (const child of children.values()) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await running.catch(() => {});
  });
  return { running, calls, children, messages, deadlines, cancelled, signalSource, wait,
    release: (name, result = 'success') => children.get(name).send(result),
    get report() { return report; }, get reports() { return reports; }, get settled() { return settled; } };
}

function gone(pid) {
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', `Process ${pid} must have exited before bootstrap settles`);
}
function phaseNames(h) { return h.report.phases.map(phase => phase.phase).sort(); }

test('bootstrap validates exact runtime, npm and locked browser pins before launching commands', async () => {
  assert.deepEqual(phaseTimeouts, { 'npm-version': 120000, dependencies: 300000, 'browser-pull': 300000 });
  assert.deepEqual(bootstrapPlan({ source: environment(), nodeVersion: '24.21.0' }), {
    'npm-version': ['npm', ['install', '--global', 'npm@12.1.0']], dependencies: ['npm', ['ci']],
    'browser-pull': ['docker', ['pull', image]],
  });
  for (const change of [
    { nodeVersion: '24.20.0' },
    { source: { ...environment(), PLAYWRIGHT_CONTAINER_IMAGE: 'mcr.microsoft.com/playwright:v1.64.0-noble' } },
    { source: { ...environment(), PLAYWRIGHT_CONTAINER_IMAGE: 'untrusted; echo credentials' } },
    { read: filename => filename.endsWith('package.json') ? JSON.stringify({ ...require('../../../package.json'), packageManager: 'npm@12.0.0' }) : fs.readFileSync(filename, 'utf8') },
    { read: filename => filename.endsWith('package-lock.json') ? JSON.stringify({ packages: {} }) : fs.readFileSync(filename, 'utf8') },
    { read: filename => filename.endsWith('.nvmrc') ? '24.20.0' : fs.readFileSync(filename, 'utf8') },
  ]) {
    let spawns = 0, reports = 0;
    await assert.rejects(runBrowserBootstrap({ source: environment(), workspace: root, nodeVersion: '24.21.0', ...change,
      spawnProcess() { spawns += 1; assert.fail('A mismatched bootstrap must not launch'); },
      timing: { report() { reports += 1; } }, signalSource: new EventEmitter() }), /requires|match/);
    assert.equal(spawns, 0); assert.equal(reports, 1);
  }
});

test('browser pull overlaps npm installation while npm check and ci remain ordered; both branches gate success', async t => {
  const h = harness(t);
  await Promise.all([h.wait('npm-version'), h.wait('browser-pull')]);
  assert.deepEqual(h.calls, ['npm-version', 'browser-pull'], 'Both held branches launched before either can finish');
  h.release('npm-version');
  await h.wait('dependencies');
  assert.deepEqual(h.calls, ['npm-version', 'browser-pull', 'npm-check', 'dependencies']);
  assert.equal(h.messages.some(message => message.name === 'browser-pull' && message.kind === 'close'), false,
    'Dependency installation starts while the image pull is still held');
  h.release('browser-pull'); await h.wait('browser-pull', 'close');
  assert.equal(h.settled, false, 'Successful image pull alone cannot complete bootstrap');
  h.release('dependencies'); await h.running;
  assert.equal(h.reports, 1); assert.equal(h.report.measurements, 3);
  assert.equal(Object.keys(h.report.chunks).length, 1, 'All setup phases have one collector/report writer');
  assert.deepEqual(phaseNames(h), ['ci.browser-pull', 'ci.dependencies', 'ci.npm-version']);
  assert.ok(h.report.phases.every(phase => phase.failed === 0));
  assert.deepEqual(h.cancelled.map(deadline => deadline.milliseconds).sort(), [120000, 300000, 300000]);
  assert.equal(h.signalSource.listenerCount('SIGINT'), 0); assert.equal(h.signalSource.listenerCount('SIGTERM'), 0);
});

for (const failing of ['npm-version', 'browser-pull', 'dependencies']) {
  test(`${failing} failure stops the other branch and waits for its descendant process group`, async t => {
    const survivor = failing === 'browser-pull' ? 'npm-version' : 'browser-pull';
    const h = harness(t, { [survivor]: { descendant: true, holdDrain: true } });
    await Promise.all([h.wait('npm-version'), h.wait('browser-pull')]);
    if (failing === 'dependencies') { h.release('npm-version'); await h.wait('dependencies'); }
    const survivorReady = await h.wait(survivor);
    h.release(failing, 'failure');
    await h.wait(survivor, 'term');
    assert.equal(h.settled, false, 'Failure must wait for the surviving process group to drain');
    h.release(survivor, 'drain');
    await assert.rejects(h.running, /status 23/);
    gone(survivorReady.pid); gone(survivorReady.descendant);
    if (failing !== 'dependencies') assert.equal(h.calls.includes('dependencies'), false, 'Failed setup cannot launch npm ci');
    assert.equal(h.reports, 1);
    const records = Object.values(h.report.chunks).flat();
    assert.ok(records.find(record => record.phase === `ci.${failing}`).failed);
    assert.ok(records.find(record => record.phase === `ci.${survivor}`).failed);
  });
}

test('installed npm mismatch never starts dependency installation and cancels image pull', async t => {
  const h = harness(t, { version: '12.0.0' });
  const [npm, pull] = await Promise.all([h.wait('npm-version'), h.wait('browser-pull')]);
  h.release('npm-version');
  await assert.rejects(h.running, /installed npm 12\.1\.0/);
  assert.equal(h.calls.includes('dependencies'), false);
  gone(npm.pid); gone(pull.pid);
  assert.deepEqual(phaseNames(h), ['ci.browser-pull', 'ci.npm-version']);
  assert.ok(h.report.phases.every(phase => phase.failed === 1));
});

for (const expired of ['npm-version', 'browser-pull', 'dependencies']) {
  test(`${expired} timeout stops and drains both process groups with the fixed phase bound`, async t => {
    const h = harness(t);
    await Promise.all([h.wait('npm-version'), h.wait('browser-pull')]);
    if (expired === 'dependencies') { h.release('npm-version'); await h.wait('dependencies'); }
    const active = expired === 'dependencies' ? ['dependencies', 'browser-pull'] : ['npm-version', 'browser-pull'];
    // The two five-minute timers have different handles. Select only the
    // still-running phase: npm/dependency phases are launched in order.
    const duration = phaseTimeouts[expired];
    h.deadlines.get(duration).callback();
    await assert.rejects(h.running, new RegExp(`CI ${expired} exceeded its`));
    for (const name of active) gone((await h.wait(name)).pid);
    assert.equal(h.reports, 1);
    assert.ok(h.report.phases.find(phase => phase.phase === `ci.${expired}`).failed);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} cancels both branches, escalates ignored termination and preserves its exit code`, async t => {
    const h = harness(t, { 'npm-version': { ignoreTerm: true }, 'browser-pull': { ignoreTerm: true }, terminationGraceMillis: 50 });
    const ready = await Promise.all([h.wait('npm-version'), h.wait('browser-pull')]);
    h.signalSource.emit(signal);
    await assert.rejects(h.running, error => {
      assert.match(error.message, new RegExp(`interrupted by ${signal}`));
      assert.equal(error.exitCode, signal === 'SIGINT' ? 130 : 143); return true;
    });
    for (const child of ready) {
      gone(child.pid);
      const closed = await h.wait(child.name, 'close'); assert.equal(closed.signal, 'SIGKILL');
    }
    assert.equal(h.calls.includes('dependencies'), false); assert.equal(h.reports, 1);
    assert.ok(h.report.phases.every(phase => phase.failed === 1));
    assert.equal(h.signalSource.listenerCount('SIGINT'), 0); assert.equal(h.signalSource.listenerCount('SIGTERM'), 0);
  });
}

test('bootstrap and every eagerly loaded helper require only built-ins before npm ci', () => {
  const cache = new Map();
  function load(filename) {
    filename = require.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: loaded, __dirname: path.dirname(filename),
      process, setTimeout, clearTimeout, console,
      require(name) {
        if (name.startsWith('node:')) return require(name);
        assert.ok(name.startsWith('.'), 'Pre-install bootstrap may not require an installed package');
        return load(path.resolve(path.dirname(filename), name));
      },
    }, { filename });
    return loaded.exports;
  }
  assert.equal(typeof load(path.join(root, 'scripts/ci-browser-bootstrap.cjs')).runBrowserBootstrap, 'function');
});
