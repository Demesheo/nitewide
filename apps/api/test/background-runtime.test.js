const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWorkerRuntime } = require('../src/background/runtime');
const { supervise } = require('../../../deploy/supervise.cjs');

test('worker lanes do not overlap, long export does not block notifications, stop waits for active work', async () => {
  let release, entered = 0, finished = false, notifications = 0, heartbeats = 0;
  const blocker = new Promise(resolve => { release = resolve; });
  const exports = { drain: async () => { entered++; await blocker; finished = true; }, stop: async () => blocker };
  const noOp = { enabled: false, drain: async () => 0, stop: async () => {} };
  const runtime = createWorkerRuntime({ sequelize: { authenticate: async () => {}, query: async () => { heartbeats++; } },
    services: { email: noOp, notifications: { ...noOp, drain: async () => { notifications++; } }, exports: [exports] }, pollIntervalMs: 5 });
  await runtime.start();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(entered, 1); assert.ok(notifications > 1); assert.ok(heartbeats > 2);
  const stopped = runtime.stop(); assert.equal(runtime.stop(), stopped);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
  release(); await stopped;
  const count = notifications;
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(notifications, count);
});

test('free-demo supervisor uses separate processes and fails closed if a child exits unexpectedly', () => {
  const children = [], entries = []; let exit;
  const instance = supervise({ spawnImpl: (_command, args) => {
    entries.push(args[0]); const child = new EventEmitter(); child.signals = [];
    child.kill = signal => child.signals.push(signal); children.push(child); return child;
  }, onExit: code => { exit = code; } });
  assert.match(entries[0], /server\.js$/); assert.match(entries[1], /worker\.js$/);
  children[1].emit('close', 1); assert.deepEqual(children[0].signals, ['SIGTERM']);
  children[0].emit('close', 0); assert.equal(exit, 1); instance.stop();
});

test('API server has no email, notification or export dispatch timer', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/server'), 'utf8');
  assert.doesNotMatch(source, /setInterval|\.drain\(/);
});

test('media cleanup has its own worker lane and shutdown waits for an in-flight deletion', async () => {
  let release, started = false, closed = false;
  const deletion = new Promise(resolve => { release = resolve; });
  const noop = { enabled: false, drain: async () => 0, stop: async () => {} };
  const media = { enabled: true, drain: async () => { started = true; await deletion; }, stop: async () => { await deletion; closed = true; } };
  const heartbeats = [];
  const runtime = createWorkerRuntime({ sequelize: { authenticate: async () => {}, query: async (_sql, options) => heartbeats.push(JSON.parse(options.replacements.details)) },
    services: { email: noop, notifications: noop, exports: [], media }, pollIntervalMs: 5 });
  await runtime.start(); assert.equal(started, true);
  assert.equal(heartbeats[0].mediaCleanupEnabled, true);
  const stop = runtime.stop(); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false);
  release(); await stop; assert.equal(closed, true);
});
