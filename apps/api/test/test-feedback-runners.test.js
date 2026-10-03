const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { quickEnvironment, createCommandRunner } = require('../../../scripts/test-command.cjs');
const { frontendWorkspaces, runQuick } = require('../../../scripts/run-quick-tests.cjs');
const { runRelease } = require('../../../scripts/run-release-tests.cjs');
const { runReportPlans, main: reportPlansMain } = require('../../../scripts/run-report-plans.cjs');
const { selectAffected, changedFiles, parseOptions, projectsByApp, specsByApp, runAffected } = require('../../../scripts/run-affected-tests.cjs');
const { main: runBrowser, allowsLocalBuildReuse } = require('../../../e2e/run.cjs');
const { inputFingerprint, isBuildFresh, recordBuild } = require('../../../e2e/build-freshness.cjs');

const timing = { measure: async (_phase, operation) => operation(), record() {}, report() {} };
function recorder() {
  const calls = [];
  return { calls, npm: async (args, options) => { calls.push({ command: 'npm', args, options }); },
    run: async (command, args, options) => { calls.push({ command, args, options }); } };
}

test('quick verification explicitly runs all frontend tests and API unit mode without database/provider access', async () => {
  const runner = recorder();
  await runQuick({ runner, timing });
  assert.deepEqual(frontendWorkspaces(), ['admin', 'business', 'customer']);
  assert.deepEqual(runner.calls.map(({ args }) => args), [
    ['test', '--workspace', '@nitewide/admin'], ['test', '--workspace', '@nitewide/business'],
    ['test', '--workspace', '@nitewide/customer'], ['apps/api/scripts/run-tests.cjs', '--unit'],
  ]);
  const env = quickEnvironment({ DATABASE_URL: 'postgres://private:secret@production.example/main', TEST_DATABASE_URL: 'remote',
    TEST_DATABASE_MANAGED: '1', RUN_DB_TESTS: '1', RUN_ORLANDO_SEED_TESTS: '1', STRIPE_SECRET_KEY: 'secret', RESEND_API_KEY: 'secret', R2_SECRET_ACCESS_KEY: 'secret' });
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1'); assert.equal(new URL(env.DATABASE_URL).port, '1');
  for (const key of ['TEST_DATABASE_URL', 'TEST_DATABASE_MANAGED', 'RUN_DB_TESTS', 'RUN_ORLANDO_SEED_TESTS', 'STRIPE_SECRET_KEY', 'RESEND_API_KEY', 'R2_SECRET_ACCESS_KEY']) assert.equal(env[key], '', key);
  for (const call of runner.calls) assert.equal(call.options.env.DATABASE_URL, env.DATABASE_URL);
});

test('release remains complete while explicit query-plan profiling uses the isolated full reporting suite', async () => {
  const runner = recorder();
  await runRelease({ runner, timing });
  assert.deepEqual(runner.calls.map(({ args }) => args), [['test'], ['run', 'test:e2e']]);
  let calls = 0;
  await assert.rejects(runRelease({ runner: { npm: async () => { calls++; throw new Error('Node verification failed'); } }, timing }), /Node verification failed/);
  assert.equal(calls, 1, 'Browser execution cannot replace failed Node verification.');
  const plans = recorder();
  await runReportPlans({ runner: plans, timing, environment: { STRIPE_SECRET_KEY: 'secret', DATABASE_URL: 'postgres://private:secret@remote/main' } });
  assert.equal(plans.calls.length, 1);
  assert.equal(plans.calls[0].command, process.execPath);
  assert.deepEqual(plans.calls[0].args, ['apps/api/scripts/run-tests.cjs', '--integration', '--suite', 'report-export-integration.test.js']);
  assert.equal(plans.calls[0].options.env.NITEWIDE_TEST_QUERY_PLANS, '1');
  assert.equal(plans.calls[0].options.env.STRIPE_SECRET_KEY, '');
  assert.equal(new URL(plans.calls[0].options.env.DATABASE_URL).hostname, '127.0.0.1');
  await assert.rejects(reportPlansMain(['--suite', 'other.test.js']), /accepts no filters/);
});

test('affected frontend selection keeps cross-app source consumers, both devices and all selected app specs', () => {
  const customer = selectAffected(['apps/customer/src/components/my-event-detail.jsx'], { ci: false });
  assert.equal(customer.mode, 'selected'); assert.deepEqual(customer.frontendApps, ['admin', 'business', 'customer']);
  assert.deepEqual(customer.projects, Object.values(projectsByApp).flat().sort());
  assert.deepEqual(customer.specs, [...new Set(Object.values(specsByApp).flat())].sort());
  const admin = selectAffected(['apps/admin/src/main.jsx'], { ci: false });
  assert.deepEqual(admin.projects, Object.values(projectsByApp).flat().sort());
  assert.deepEqual(selectAffected(['apps/admin/public/logo.svg'], { ci: false }).projects, [...projectsByApp.admin].sort());
  const testOnly = selectAffected(['apps/business/test/business-payments-interactions.test.js'], { ci: false });
  assert.deepEqual(testOnly.frontendApps, ['business']); assert.deepEqual(testOnly.projects, []);
  for (const app of Object.keys(projectsByApp)) for (const projectName of projectsByApp[app]) {
    const configured = require('../../../playwright.config.cjs').projects.find(project => project.name === projectName);
    assert.ok(configured, projectName); assert.deepEqual(configured.testMatch, specsByApp[app]);
  }
});

test('affected browser spec selection uses exact configured specs/projects and broadens every unknown dependency', async () => {
  const plan = selectAffected(['e2e/specs/business-payments.spec.cjs'], { ci: false });
  assert.equal(plan.mode, 'selected'); assert.deepEqual(plan.projects, [...projectsByApp.business].sort());
  assert.deepEqual(plan.specs, ['business-payments.spec.cjs']);
  const runner = recorder(); await runAffected(plan, { runner, timing });
  assert.deepEqual(runner.calls.at(-1).args, ['run', 'test:e2e', '--', '--project=business-desktop', '--project=business-iphone', 'e2e/specs/business-payments.spec.cjs']);
  for (const file of ['apps/api/src/services/checkout-service.js', 'apps/api/src/db/migrations/new.js', 'apps/api/test/new.test.js',
    'apps/pricing/index.cjs', 'apps/customer/vite.config.js', 'apps/customer/package.json', 'package-lock.json', 'playwright.config.cjs',
    'e2e/fixtures.cjs', 'e2e/specs/new.spec.cjs', 'e2e/specs/admin.spec.cjs', 'deploy/Dockerfile', '.github/workflows/demo-image.yml',
    'docs/UI_TESTING.md', '../apps/customer/src/App.jsx', 'apps/customer/src/../../business/src/App.jsx']) {
    assert.equal(selectAffected(['apps/customer/src/App.jsx', file], { ci: false }).mode, 'release', file);
  }
  assert.equal(selectAffected(['apps/customer/src/App.jsx'], { ci: true }).mode, 'release');
  assert.equal(selectAffected([], { ci: false }).mode, 'quick');
  const fallback = recorder(); await runAffected({ mode: 'release' }, { runner: fallback, timing });
  assert.deepEqual(fallback.calls.map(({ args }) => args), [['run', 'test:release']]);
});

test('affected Git discovery includes tracked worktree/staged edits, untracked files and the requested base', async () => {
  const calls = [];
  const responses = ['apps/customer/src/App.jsx\0apps/admin/src/main.jsx\0', 'new-file.cjs\0', 'a'.repeat(40) + '\n', 'apps/pricing/index.cjs\0apps/customer/src/App.jsx\0'];
  const files = await changedFiles({ run: async (command, args) => { calls.push({ command, args }); return responses.shift(); } }, 'origin/main');
  assert.deepEqual(files, ['apps/admin/src/main.jsx', 'apps/customer/src/App.jsx', 'apps/pricing/index.cjs', 'new-file.cjs']);
  assert.deepEqual(calls[0].args, ['diff', '--no-renames', '--name-only', '-z', 'HEAD', '--']);
  assert.deepEqual(calls[2].args, ['rev-parse', '--verify', '--end-of-options', 'origin/main^{commit}']);
  assert.equal(calls[3].args[4], `${'a'.repeat(40)}...HEAD`);
  assert.deepEqual(parseOptions(['--base', 'HEAD~1', '--dry-run']), { base: 'HEAD~1', dryRun: true });
  for (const args of [['--base'], ['--base', '--unsafe'], ['--workers=2'], ['--dry-run', '--dry-run']]) assert.throws(() => parseOptions(args));
});

test('browser listing skips builds and file reporters while targeted build reuse stays unavailable in CI', async () => {
  const runner = recorder();
  await runBrowser(['--list', '--project=customer-iphone'], { runner, timing });
  assert.equal(runner.calls.length, 1); assert.equal(runner.calls[0].command, process.execPath);
  assert.equal(runner.calls[0].args[1], 'test'); assert.ok(runner.calls[0].args.includes('--list'));
  assert.equal(runner.calls[0].args.at(-1), '--reporter=list', 'Inventory must not overwrite the executed HTML/JUnit/timing reports.');
  const overridden = recorder();
  const previousReporter = process.env.PW_TEST_REPORTER;
  process.env.PW_TEST_REPORTER = './e2e/timing-reporter.cjs';
  try {
    await runBrowser(['--list', '--reporter=junit'], { runner: overridden, timing });
    assert.equal(overridden.calls[0].args.at(-1), '--reporter=list');
    assert.equal(overridden.calls[0].options.env.PW_TEST_REPORTER, '');
  } finally {
    if (previousReporter === undefined) delete process.env.PW_TEST_REPORTER;
    else process.env.PW_TEST_REPORTER = previousReporter;
  }
  for (const reporters of [['--add-reporter=html'], ['--add-reporter', './e2e/timing-reporter.cjs']]) {
    await assert.rejects(runBrowser(['--list', ...reporters], { runner: recorder(), timing }), /only its console reporter/);
  }
  assert.equal(allowsLocalBuildReuse(['--project=customer-iphone'], {}), true);
  assert.equal(allowsLocalBuildReuse(['--project', 'business-desktop'], {}), true);
  assert.equal(allowsLocalBuildReuse(['--project=customer-iphone'], { CI: 'true' }), false);
  for (const args of [[], ['--project=*'], ['--project=customer-iphone', '--project=unknown'], ['--project']]) assert.equal(allowsLocalBuildReuse(args, {}), false);
});

test('local browser build freshness detects content, deletion, shared/environment and output changes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nitewide-build-freshness-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, content) => { const filename = path.join(directory, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, content); };
  write('apps/customer/src/main.jsx', 'first'); write('apps/customer/dist/index.html', '<html>first</html>');
  write('apps/customer/dist/assets/main.js', 'compiled'); write('apps/pricing/index.cjs', 'fees'); write('e2e/environment.cjs', 'isolated');
  const env = { NODE_ENV: 'production', VITE_API_URL: '/api' };
  const original = inputFingerprint(directory, 'customer', env);
  assert.equal(isBuildFresh(directory, 'customer', original), false);
  recordBuild(directory, 'customer', original); assert.equal(isBuildFresh(directory, 'customer', original), true);
  write('apps/customer/src/main.jsx', 'second'); assert.notEqual(inputFingerprint(directory, 'customer', env), original);
  write('apps/customer/src/main.jsx', 'first'); assert.equal(inputFingerprint(directory, 'customer', env), original);
  fs.unlinkSync(path.join(directory, 'apps/customer/src/main.jsx')); assert.notEqual(inputFingerprint(directory, 'customer', env), original);
  write('apps/customer/src/main.jsx', 'first'); write('apps/pricing/index.cjs', 'fees changed'); assert.notEqual(inputFingerprint(directory, 'customer', env), original);
  write('apps/pricing/index.cjs', 'fees'); assert.notEqual(inputFingerprint(directory, 'customer', { ...env, VITE_API_URL: '/changed' }), original);
  write('apps/business/src/lib/commissions.js', 'shared import'); assert.notEqual(inputFingerprint(directory, 'customer', env), original);
  fs.rmSync(path.join(directory, 'apps/business'), { recursive: true });
  write('apps/shared/copy-link-button.jsx', 'shared component'); assert.notEqual(inputFingerprint(directory, 'customer', env), original);
  fs.rmSync(path.join(directory, 'apps/shared'), { recursive: true });
  write('apps/customer/dist/assets/main.js', 'different build'); assert.equal(isBuildFresh(directory, 'customer', original), false);
  recordBuild(directory, 'customer', original); fs.unlinkSync(path.join(directory, 'apps/customer/dist/assets/main.js')); assert.equal(isBuildFresh(directory, 'customer', original), false);
});

test('cancellation reaches detached child process groups, waits for close and prevents another command', async () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const source = new EventEmitter(), handle = new EventEmitter(), killed = [];
    handle.pid = 12345;
    let spawnOptions;
    const runner = createCommandRunner({ signalSource: source, platform: 'linux', killGroup: (...args) => killed.push(args),
      spawnChild: (_command, _args, options) => { spawnOptions = options; return handle; } });
    const completion = runner.run('node', ['test']);
    assert.equal(spawnOptions.detached, true);
    source.emit(signal); assert.deepEqual(killed, [[-12345, 'SIGTERM']]);
    assert.equal(runner.exitCode, signal === 'SIGINT' ? 130 : 143);
    handle.emit('close', 0, null);
    await assert.rejects(completion, /interrupted/);
    await assert.rejects(runner.run('node', ['next']), /interrupted/);
    runner.dispose(); assert.equal(source.listenerCount('SIGINT'), 0); assert.equal(source.listenerCount('SIGTERM'), 0);
  }
});

test('the cancellation watchdog is bounded and never kills an already closed process group', async () => {
  for (const closes of [true, false]) {
    const source = new EventEmitter(), handle = new EventEmitter(), killed = [], warnings = [], cancelled = [];
    handle.pid = 12345;
    let deadline;
    const timer = { unref() {} };
    const runner = createCommandRunner({ signalSource: source, platform: 'linux', killGroup: (...args) => killed.push(args),
      spawnChild: () => handle, schedule: (operation, timeout) => { assert.equal(timeout, 30000); deadline = operation; return timer; },
      cancelSchedule: value => cancelled.push(value), warn: message => warnings.push(message) });
    const completion = runner.run('node', ['test']); source.emit('SIGTERM');
    if (closes) handle.emit('close', 0, null);
    deadline();
    assert.deepEqual(killed, closes ? [[-12345, 'SIGTERM']] : [[-12345, 'SIGTERM'], [-12345, 'SIGKILL']]);
    assert.equal(warnings.length, closes ? 0 : 1);
    if (!closes) { assert.match(warnings[0], /database cleanup diagnostics/); handle.emit('close', null, 'SIGKILL'); }
    await assert.rejects(completion, /interrupted/); runner.dispose(); assert.deepEqual(cancelled, [timer]);
  }
});

// Model cache evidence in memory: this audit must never build an app or touch
// an actual database, browser, provider, or installed production asset.
function buildTree() {
  const root = '/mock-nitewide';
  const files = new Map();
  const filename = relative => path.join(root, relative);
  const write = (relative, content, kind = 'file') => files.set(filename(relative), { content, kind });
  const children = directory => [...files.keys()].filter(file => file.startsWith(`${directory}/`))
    .map(file => file.slice(directory.length + 1).split('/')[0]);
  const entry = file => files.get(file) || (children(file).length ? { kind: 'directory' } : null);
  const fakeFs = {
    existsSync: file => Boolean(entry(path.normalize(file))),
    lstatSync: file => {
      const value = entry(path.normalize(file));
      if (!value) throw new Error('Missing mock file');
      return { size: Buffer.byteLength(value.content || ''),
        isSymbolicLink: () => value.kind === 'symlink',
        isDirectory: () => value.kind === 'directory',
        isFile: () => value.kind === 'file' };
    },
    readdirSync: directory => [...new Set(children(path.normalize(directory)))],
    readFileSync: (file, encoding) => {
      const value = files.get(path.normalize(file));
      if (!value || value.kind !== 'file') throw new Error('Unreadable mock file');
      return encoding ? value.content : Buffer.from(value.content);
    },
    writeFileSync: (file, content) => files.set(path.normalize(file), { content, kind: 'file' }),
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../../../e2e/build-freshness.cjs'), 'utf8');
  vm.runInNewContext(source, { module, process, require(name) {
    if (name === 'node:fs') return fakeFs;
    assert.ok(['node:path', 'node:crypto'].includes(name));
    return require(name);
  } });
  write('apps/customer/src/main.jsx', 'current source');
  write('apps/customer/dist/index.html', '<html>isolated build</html>');
  write('apps/customer/dist/assets/main.js', 'compiled isolated source');
  return { root, files, write, remove: relative => files.delete(filename(relative)), ...module.exports };
}

test('freshness evidence requires readable complete output and a matching SHA256 digest', () => {
  const cache = buildTree();
  const input = 'a'.repeat(64);
  cache.recordBuild(cache.root, 'customer', input);
  assert.equal(cache.isBuildFresh(cache.root, 'customer', input), true);
  const output = cache.outputFingerprint(cache.root, 'customer');
  assert.match(output, /^[a-f0-9]{64}$/);
  const marker = `apps/customer/dist/${cache.markerName}`;
  for (const value of [null, '', false, {}, [], 'not-a-digest']) {
    cache.write(marker, JSON.stringify({ version: 1, input, output: value }));
    assert.equal(cache.isBuildFresh(cache.root, 'customer', input), false);
  }
  cache.write(marker, '{truncated');
  assert.equal(cache.isBuildFresh(cache.root, 'customer', input), false);
  cache.write(marker, JSON.stringify({ version: 1, input, output }));
  cache.remove('apps/customer/dist/index.html');
  assert.equal(cache.outputFingerprint(cache.root, 'customer'), null);
  assert.equal(cache.isBuildFresh(cache.root, 'customer', input), false);
  // A malformed null digest must not make absent output equal valid evidence.
  cache.write(marker, JSON.stringify({ version: 1, input, output: null }));
  assert.equal(cache.isBuildFresh(cache.root, 'customer', input), false);
});

test('linked source and linked compiled output cannot certify a reusable build', () => {
  const cache = buildTree();
  const environment = { NODE_ENV: 'production', VITE_API_URL: '/api' };
  const input = cache.inputFingerprint(cache.root, 'customer', environment);
  assert.match(input, /^[a-f0-9]{64}$/);
  cache.recordBuild(cache.root, 'customer', input);
  cache.write('apps/customer/src/main.jsx', '/outside/source.jsx', 'symlink');
  assert.equal(cache.inputFingerprint(cache.root, 'customer', environment), null);
  assert.equal(cache.isBuildFresh(cache.root, 'customer', null), false);
  cache.write('apps/customer/src/main.jsx', 'current source');
  cache.write('apps/customer/dist/assets/main.js', '/outside/build.js', 'symlink');
  assert.equal(cache.outputFingerprint(cache.root, 'customer'), null);
  assert.equal(cache.isBuildFresh(cache.root, 'customer', input), false);
});
