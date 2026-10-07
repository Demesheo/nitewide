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

test('staging deployments validate targets, wait for the exact release, then require worker parity', async () => {
  const { settings, run: deploy } = require('../../../deploy/staging.cjs');
  const env = { GITHUB_REF: 'refs/heads/staging', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'a'.repeat(40),
    IMAGE: 'ghcr.io/demesheo/nitewide', DIGEST: `sha256:${'b'.repeat(64)}`,
    STAGING_API_SERVICE_ID: 'srv-stagingapi', STAGING_WORKER_SERVICE_ID: 'srv-stagingworker',
    RENDER_STAGING_API_DEPLOY_HOOK: 'https://api.render.com/deploy/srv-stagingapi?key=private-api-hook',
    RENDER_STAGING_WORKER_DEPLOY_HOOK: 'https://api.render.com/deploy/srv-stagingworker?key=private-worker-hook',
    STAGING_READINESS_URL: 'https://staging.example.onrender.com/health/ready' };
  for (const invalid of [{ GITHUB_REF: 'refs/heads/main' }, { GITHUB_REF: 'refs/heads/production' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { DIGEST: 'latest' }, { IMAGE: 'ghcr.io/demesheo/nitewide-demo' },
    { STAGING_WORKER_SERVICE_ID: env.STAGING_API_SERVICE_ID }, { RENDER_STAGING_WORKER_DEPLOY_HOOK: '' },
    { RENDER_STAGING_API_DEPLOY_HOOK: 'https://api.render.com/deploy/srv-demo?key=private' },
    { RENDER_STAGING_API_DEPLOY_HOOK: `${env.RENDER_STAGING_API_DEPLOY_HOOK}&ref=main` },
    { RENDER_STAGING_API_DEPLOY_HOOK: 'https://private@api.render.com/deploy/srv-stagingapi?key=private' },
    { STAGING_READINESS_URL: 'http://localhost/health/ready' }, { STAGING_READINESS_URL: 'https://nitewide.com/health/ready' },
    { STAGING_READINESS_URL: `${env.STAGING_READINESS_URL}?requireWorker=false` }]) assert.throws(() => settings({ ...env, ...invalid }));
  const calls = [], logs = []; let clock = 0, apiChecks = 0, workerChecks = 0;
  const response = (status, revision = env.GITHUB_SHA, environment = 'staging', body = { status: 'ok', service: 'nitewide-api' }) => ({
    status, headers: new Headers({ 'x-nitewide-revision': revision, 'x-nitewide-environment': environment }), json: async () => body,
  });
  await deploy(env, { log: value => logs.push(value), now: () => clock, pause: async ms => { clock += ms; }, fetchImpl: async (url, options) => {
    url = new URL(url); calls.push([url.pathname, url.searchParams.get('requireWorker')]);
    assert.equal(options.redirect, 'error');
    if (options.method === 'POST') {
      assert.equal(url.searchParams.get('imgURL'), `${env.IMAGE}@${env.DIGEST}`);
      if (url.pathname.endsWith('stagingworker')) assert.equal(apiChecks, 4);
      return response(202);
    }
    if (url.searchParams.has('requireWorker')) return response(++workerChecks === 1 ? 503 : 200);
    apiChecks++;
    if (apiChecks === 1) return response(200, 'c'.repeat(40)); // old healthy release
    if (apiChecks === 2) return response(200, env.GITHUB_SHA, 'production');
    if (apiChecks === 3) return response(200, env.GITHUB_SHA, 'staging', { status: 'degraded', service: 'nitewide-api' });
    return response(200);
  } });
  assert.equal(calls.filter(([path]) => path.startsWith('/deploy/')).length, 2);
  assert.equal(workerChecks, 2); assert.match(logs.at(-1), /API and worker verified/);
  assert.doesNotMatch(logs.join('\n'), /private-|key=|fingerprint/);
  for (const fail of ['rejected', 'uncertain', 'not-ready']) {
    let requests = 0; clock = 0;
    await assert.rejects(deploy(env, { log() {}, now: () => clock, timeoutMs: 20000, pause: async ms => { clock += ms; }, fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        requests++;
        if (fail === 'uncertain') throw new Error(env.RENDER_STAGING_API_DEPLOY_HOOK);
        return response(fail === 'rejected' ? 400 : 200);
      }
      return response(200, 'c'.repeat(40));
    } }), error => !/private-|key=/.test(error.message) && /rejected|uncertain|Timed out/.test(error.message));
    assert.equal(requests, 1, 'never retry ambiguous deploys or start a worker before API readiness');
  }
});
