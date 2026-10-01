const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerShutdown } = require('../src/background/shutdown');

function fixture(overrides = {}) {
  const calls = [];
  const runtime = { stop: async () => calls.push('stop') };
  const sequelize = { close: async () => calls.push('close') };
  const diagnostics = { log: (event, fields) => calls.push([event, fields.outcome]) };
  const shutdown = createWorkerShutdown({ runtime, sequelize, diagnostics, timeoutMs: 30, exit: code => calls.push(['exit', code]), ...overrides });
  return { shutdown, calls };
}

test('worker shutdown drains before closing the pool and is idempotent', async () => {
  const { shutdown, calls } = fixture();
  const first = shutdown();
  assert.equal(shutdown(), first);
  assert.equal(await first, 0);
  assert.deepEqual(calls, ['stop', 'close', ['worker_shutdown', 'ok'], ['exit', 0]]);
});

test('worker failure exits without logging raw job errors', async () => {
  const { shutdown, calls } = fixture({ runtime: { stop: async () => { throw new Error('private credentials'); } } });
  assert.equal(await shutdown(), 1);
  assert.deepEqual(calls, [['worker_shutdown', 'error'], ['exit', 1]]);
});

test('worker startup failure retains a failure exit after successful cleanup', async () => {
  const { shutdown, calls } = fixture();
  assert.equal(await shutdown(1), 1);
  assert.deepEqual(calls, ['stop', 'close', ['worker_shutdown', 'error'], ['exit', 1]]);
});

test('worker signal callback values still use the graceful success exit', async () => {
  const { shutdown } = fixture();
  assert.equal(await shutdown('SIGTERM'), 0);
});

for (const stage of ['stop', 'close']) {
  test(`worker shutdown is bounded when ${stage} never settles`, async () => {
    const never = () => new Promise(() => {});
    const { shutdown, calls } = fixture(stage === 'stop' ? { runtime: { stop: never } } : { sequelize: { close: never } });
    assert.equal(await shutdown(), 1);
    assert.deepEqual(calls.slice(-2), [['worker_shutdown', 'forced'], ['exit', 1]]);
  });
}
