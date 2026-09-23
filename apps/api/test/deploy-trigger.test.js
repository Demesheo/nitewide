const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../../deploy/trigger-demo.cjs');

test('help and dry run do not authenticate or dispatch', async () => {
  for (const option of ['--help', '--dry-run']) {
    const messages = [];
    await run([option], { env: {}, fetchImpl: () => assert.fail('network'), spawn: () => assert.fail('CLI'), log: value => messages.push(value) });
    assert.ok(messages.length);
  }
});
test('unknown arguments cannot redirect deployment to other branches', async () => {
  await assert.rejects(run(['--ref', 'other']), /Unknown option/);
});
test('token dispatch targets the fixed repository workflow on main without exposing secrets', async () => {
  const messages = [];
  await run([], { env: { GH_TOKEN: 'test-secret' }, log: value => messages.push(value), fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Demesheo/nitewide/actions/workflows/demo-image.yml/dispatches');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { ref: 'main' });
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return { ok: true, status: 204 };
  } });
  assert.match(messages.join('\n'), /not complete yet/);
  assert.doesNotMatch(messages.join('\n'), /test-secret/);
});
test('API denial and uncertain network results fail without leaking response content', async () => {
  await assert.rejects(run([], { env: { GITHUB_TOKEN: 'test' }, fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
  await assert.rejects(run([], { env: { GITHUB_TOKEN: 'test' }, fetchImpl: async () => { throw new Error('private detail'); } }), /Check Actions before retrying/);
});
test('authenticated CLI fallback dispatches only remote main', async () => {
  await run([], { env: {}, log: () => {}, spawn: (command, args, options) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['workflow', 'run', 'demo-image.yml', '--repo', 'Demesheo/nitewide', '--ref', 'main']);
    assert.equal(options.timeout, 30000); return { status: 0 };
  } });
});
test('missing CLI, failed authentication and timed-out dispatch are actionable failures', async () => {
  for (const [result, pattern] of [
    [{ error: { code: 'ENOENT' } }, /Install GitHub CLI/],
    [{ status: 1, stderr: 'secret' }, /Check gh auth status/],
    [{ error: { code: 'ETIMEDOUT' } }, /Check Actions before retrying/],
  ]) await assert.rejects(run([], { env: {}, spawn: () => result }), pattern);
});
