const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { INTEGRATION_TESTS, runIntegrationSuites, runBounded, main } = require('../scripts/run-tests.cjs');
const { createTemplateDatabaseManager } = require('../scripts/test-database-template.cjs');
const { createProcessSupervisor, assertExecutedTests } = require('../scripts/test-process-supervisor.cjs');

const migrationNames = fs.readdirSync(path.resolve(__dirname, '../src/db/migrations')).filter((name) => /^(?!.*\.d\.ts$).*\.(cjs|js|cts|ts)$/.test(name)).sort();
const tap = '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';

function fakeTiming() {
  const records = [];
  let reports = 0;
  return {
    records,
    get reports() { return reports; },
    report() { reports += 1; return records; },
    async measure(phase, operation, labels = {}) {
      let failed = true;
      try { const result = await operation(); failed = false; return result; }
      finally { records.push({ phase, labels, failed }); }
    },
  };
}

function harness(settings = {}) {
  const state = { events: [], databases: new Map(), sessions: new Set(), processes: new Map(), migrationRuns: 0, suites: [], maxActiveSuites: 0, nextPid: 50000, nextUuid: 1, dropAttempts: [], signals: [] };
  const environment = { TEST_DATABASE_ADMIN_URL: 'postgres://test:test@127.0.0.1:5433/postgres', RESEND_API_KEY: 'must-be-blank', STRIPE_SECRET_KEY: 'must-be-blank', R2_ACCESS_KEY_ID: 'must-be-blank' };
  const timing = fakeTiming();
  class FakeClient {
    constructor(options) { this.name = new URL(options.connectionString).pathname.slice(1); }
    async connect() {
      if (this.name !== 'postgres') {
        assert.equal(state.databases.get(this.name)?.frozen, false, 'frozen source never receives another connection');
        state.sessions.add(this);
      }
      state.events.push(['connect', this.name]);
    }
    async end() { state.sessions.delete(this); state.events.push(['end', this.name]); }
    async query(sql, values = []) {
      state.events.push(['query', this.name, sql, values]);
      if (sql.startsWith('SELECT datname FROM pg_database')) return { rows: state.databases.has(values[0]) || settings.collision ? [{ datname: values[0] }] : [] };
      if (sql.startsWith('CREATE DATABASE')) {
        const [, name, source] = sql.match(/CREATE DATABASE "([^"]+)" TEMPLATE "([^"]+)"/);
        if (source !== 'template0') {
          assert.equal(state.databases.get(source)?.frozen, true, 'clone requires frozen template');
          assert.equal([...state.sessions].filter((client) => client.name === source).length, 0, 'all source clients close before cloning');
        }
        state.databases.set(name, { frozen: false, migrated: source !== 'template0', source });
        if (settings.createFailure) throw Object.assign(new Error('simulated lost CREATE result'), { code: 'ECONNRESET' });
        return { rows: [] };
      }
      if (sql.startsWith('ALTER DATABASE')) {
        const name = sql.match(/ALTER DATABASE "([^"]+)"/)[1];
        state.databases.get(name).frozen = true;
        return { rows: [] };
      }
      if (sql.startsWith('SELECT pg_terminate_backend')) return { rows: [] };
      if (sql.startsWith('SELECT pid FROM pg_stat_activity')) return { rows: settings.remainingSessions ? [{ pid: 123 }] : [] };
      if (sql.startsWith('DROP DATABASE')) {
        const name = sql.match(/DROP DATABASE IF EXISTS "([^"]+)"/)[1];
        assert.equal([...state.processes.values()].filter((child) => child.database === name).length, 0, 'database cleanup waits for its whole child process group');
        state.dropAttempts.push(name);
        if (settings.cleanupFailure) throw Object.assign(new Error('simulated cleanup failure'), { code: 'ECONNRESET' });
        state.databases.delete(name);
        return { rows: [] };
      }
      const database = state.databases.get(this.name);
      if (sql.startsWith('SELECT c.relname')) return { rows: settings.nonempty ? [{ relname: 'existing_application_table' }] : [] };
      if (sql.startsWith('SELECT extname')) return { rows: (database.migrated ? settings.missingPostgis ? ['plpgsql', 'pgcrypto'] : ['plpgsql', 'postgis', 'pgcrypto'] : ['plpgsql']).map((extname) => ({ extname })) };
      if (sql.startsWith('SELECT name FROM "sequelize_meta"')) return { rows: (settings.missingMigration ? migrationNames.slice(1) : migrationNames).map((name) => ({ name })) };
      throw new Error(`Unexpected mocked SQL: ${sql}`);
    }
  }
  function close(child, status = 0, signal = null) {
    if (!state.processes.has(child.pid)) return;
    state.processes.delete(child.pid);
    state.events.push(['child-close', child.database, child.suite]);
    child.emit('close', status, signal);
  }
  function spawnProcess(command, args, options) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.pid = state.nextPid++;
    child.database = new URL(options.env.DATABASE_URL).pathname.slice(1);
    child.suite = command === process.execPath ? path.basename(args.at(-1)) : 'migration';
    state.processes.set(child.pid, child);
    assert.equal(options.detached, true);
    assert.equal(options.env.RESEND_API_KEY, '');
    assert.equal(options.env.STRIPE_SECRET_KEY, '');
    assert.equal(options.env.R2_ACCESS_KEY_ID, '');
    state.events.push(['child-start', child.database, child.suite]);
    if (child.suite === 'migration') {
      state.migrationRuns += 1;
      setImmediate(() => {
        if (!settings.migrationFailure) state.databases.get(child.database).migrated = true;
        close(child, settings.migrationFailure ? 1 : 0);
      });
    } else {
      assert.ok(args.includes('--test-concurrency=1'), 'mutations inside each integration child remain sequential');
      assert.equal(state.databases.get(child.database)?.source !== 'template0', true, 'integration uses its own clone');
      state.suites.push(child.suite);
      state.maxActiveSuites = Math.max(state.maxActiveSuites, [...state.processes.values()].filter((entry) => entry.suite !== 'migration').length);
      if (!settings.holdChildren) setTimeout(() => {
        child.stdout.emit('data', settings.skipSuite === child.suite ? tap.replace('# skipped 0', '# skipped 1') : settings.emptySuite === child.suite ? tap.replace('# tests 1', '# tests 0') : tap);
        close(child, settings.failSuite === child.suite ? 1 : 0);
      }, 8);
    }
    return child;
  }
  const supervisor = createProcessSupervisor({
    spawnProcess, platform: 'darwin', stdout: { write() {} },
    processGroupExists: (pid) => state.processes.has(pid),
    killProcess(pid, signal) {
      state.signals.push([pid, signal]);
      const child = state.processes.get(-pid);
      if (child && !settings.ignoreAllSignals && (!settings.ignoreTerm || signal === 'SIGKILL')) setImmediate(() => close(child, null, signal));
    },
    terminationGraceMillis: 10, killGraceMillis: 20,
  });
  const dependencies = { environment, ClientClass: FakeClient, supervisor, timing, migrationNames, uuid: () => (state.nextUuid++).toString(16).padStart(32, '0'), log() {} };
  return { state, timing, supervisor, dependencies, close };
}

test('mandatory integration invocation migrates once from empty template0, freezes it and executes every isolated suite', async () => {
  const h = harness();
  await runIntegrationSuites(INTEGRATION_TESTS, h.dependencies);
  assert.equal(h.state.migrationRuns, 1);
  assert.deepEqual(h.state.suites, INTEGRATION_TESTS);
  assert.equal(h.state.maxActiveSuites, 2);
  assert.equal(h.state.databases.size, 0);
  assert.equal(h.state.dropAttempts.length, INTEGRATION_TESTS.length + 1);
  const creates = h.state.events.filter((event) => event[2]?.startsWith('CREATE DATABASE'));
  assert.ok(creates[0][2].includes('TEMPLATE "template0"'));
  const template = creates[0][2].match(/CREATE DATABASE "([^"]+)"/)[1];
  assert.ok(creates.slice(1).every((event) => event[2].includes(`TEMPLATE "${template}"`)));
  assert.equal(new Set(creates.map((event) => event[2].match(/CREATE DATABASE "([^"]+)"/)[1])).size, creates.length);
  const freeze = h.state.events.findIndex((event) => event[2]?.startsWith('ALTER DATABASE'));
  const sourceEnd = h.state.events.findLastIndex((event) => event[0] === 'end' && event[1] === template);
  const firstClone = h.state.events.findIndex((event) => event === creates[1]);
  assert.ok(sourceEnd < freeze && freeze < firstClone);
  assert.equal(h.timing.records.filter((record) => record.phase === 'migration-empty-database-validation').length, 1);
  assert.equal(h.timing.records.filter((record) => record.phase === 'migration-schema-validation').length, 1);
  assert.equal(h.timing.records.filter((record) => record.phase === 'integration-tests').length, INTEGRATION_TESTS.length);
  assert.equal(h.timing.records.filter((record) => record.phase === 'database-cleanup').length, INTEGRATION_TESTS.length + 1);
  assert.ok(h.timing.records.every((record) => !record.failed));
  assert.ok(h.timing.records.every((record) => Object.keys(record.labels).every((key) => ['suite', 'role'].includes(key))));
});

test('explicit concurrency one serializes suites while reusing the same required migration boundary', async () => {
  const h = harness();
  await runIntegrationSuites(INTEGRATION_TESTS.slice(0, 4), { ...h.dependencies, concurrency: 1 });
  assert.equal(h.state.migrationRuns, 1);
  assert.equal(h.state.maxActiveSuites, 1);
  assert.equal(h.state.databases.size, 0);
});

test('template cannot be cloned before mandatory empty migration and freezing', async () => {
  const h = harness();
  const manager = createTemplateDatabaseManager(h.dependencies);
  await assert.rejects(manager.clone(INTEGRATION_TESTS[0]), /fully migrated, frozen template/);
  assert.equal(h.state.events.length, 0);
});

for (const [setting, message, failedPhase] of [
  ['nonempty', /must start from an empty template0/, 'migration-empty-database-validation'],
  ['migrationFailure', /status 1/, 'migration'],
  ['missingMigration', /every checked-in migration/, 'migration-schema-validation'],
  ['missingPostgis', /PostGIS or pgcrypto/, 'migration-schema-validation'],
  ['remainingSessions', /active source sessions/, 'database-template-freeze'],
  ['createFailure', /lost CREATE result/, 'database-template-create'],
]) {
  test(`required template validation fails closed and cleans up when ${setting}`, async () => {
    const h = harness({ [setting]: true });
    await assert.rejects(runIntegrationSuites(INTEGRATION_TESTS.slice(0, 3), h.dependencies), message);
    assert.equal(h.state.suites.length, 0);
    assert.equal(h.state.databases.size, 0);
    assert.equal(h.state.processes.size, 0);
    assert.ok(h.timing.records.some((record) => record.phase === failedPhase && record.failed));
  });
}

test('an existing generated-name collision is neither reused nor dropped', async () => {
  const h = harness({ collision: true });
  await assert.rejects(runIntegrationSuites([INTEGRATION_TESTS[0]], h.dependencies), /reuse an existing/);
  assert.equal(h.state.dropAttempts.length, 0);
  assert.equal(h.state.migrationRuns, 0);
});

for (const setting of ['failSuite', 'skipSuite', 'emptySuite']) {
  test(`${setting} stops further scheduling, closes all children, cleans databases and records failure`, async () => {
    const h = harness({ [setting]: INTEGRATION_TESTS[0] });
    await assert.rejects(runIntegrationSuites(INTEGRATION_TESTS, h.dependencies), /status 1|did not execute|Test run stopped/);
    assert.ok(h.state.suites.length <= 2);
    assert.equal(h.state.processes.size, 0);
    assert.equal(h.state.databases.size, 0);
    assert.ok(h.timing.records.some((record) => record.phase === 'integration-tests' && record.failed));
    assert.ok(h.timing.records.some((record) => record.phase === 'integration-suite' && record.failed));
  });
}

test('interruption escalates both active process groups before dropping any suite database', async () => {
  const h = harness({ holdChildren: true, ignoreTerm: true });
  const run = runIntegrationSuites(INTEGRATION_TESTS, h.dependencies);
  const rejected = assert.rejects(run, /interrupted|stopped/);
  while (h.state.suites.length < 2) await new Promise((done) => setImmediate(done));
  const pids = [...h.state.processes.keys()];
  await h.supervisor.stop('SIGTERM');
  await rejected;
  assert.ok(pids.every((pid) => h.state.signals.some(([target, signal]) => target === -pid && signal === 'SIGTERM')));
  assert.ok(pids.every((pid) => h.state.signals.some(([target, signal]) => target === -pid && signal === 'SIGKILL')));
  assert.equal(h.state.databases.size, 0);
  assert.equal(h.state.processes.size, 0);
});

test('shutdown has a bounded deadline and retains databases whose child groups survive', async () => {
  const h = harness({ holdChildren: true, ignoreAllSignals: true });
  const run = runIntegrationSuites(INTEGRATION_TESTS, h.dependencies);
  const rejected = assert.rejects(run, /shutdown timed out|still running/);
  while (h.state.suites.length < 2) await new Promise((done) => setImmediate(done));
  await assert.rejects(h.supervisor.stop('SIGINT'), /shutdown timed out/);
  await rejected;
  assert.equal(h.state.suites.length, 2);
  assert.equal(h.state.databases.size, 2, 'only the live children\'s clones remain; template is safe to clean');
  for (const child of [...h.state.processes.values()]) h.close(child, null, 'SIGKILL');
});

test('cleanup failure is reported and timed without hiding the original suite failure', async () => {
  const h = harness({ failSuite: INTEGRATION_TESTS[0], cleanupFailure: true });
  await assert.rejects(runIntegrationSuites([INTEGRATION_TESTS[0]], h.dependencies), (error) => /status 1/.test(error.message) && /Cleanup failed/.test(error.message));
  assert.equal(h.state.processes.size, 0);
  assert.ok(h.timing.records.some((record) => record.phase === 'database-cleanup' && record.failed));
});

test('empty, duplicate or unclassified integration selections fail before any provisioning', async () => {
  for (const suites of [[], [INTEGRATION_TESTS[0], INTEGRATION_TESTS[0]], ['not-an-integration.test.js']]) {
    const h = harness();
    await assert.rejects(runIntegrationSuites(suites, h.dependencies), /once each|Unknown required/);
    assert.equal(h.state.events.length, 0);
  }
});

test('bounded pool fails closed for invalid limits and waits for in-flight work before returning a failure', async () => {
  for (const concurrency of [0, 3, 1.5, '2', NaN, Infinity]) await assert.rejects(runBounded([1], concurrency, async () => {}), /integer from 1 to 2/);
  const completed = [];
  await assert.rejects(runBounded([1, 2, 3], 2, async (number) => {
    if (number === 1) throw new Error('first failed');
    await new Promise((done) => setImmediate(done));
    completed.push(number);
  }), /first failed/);
  assert.deepEqual(completed, [2]);
});

test('TAP evidence must prove nonzero completed tests with no skipped, cancelled or todo coverage', () => {
  assert.doesNotThrow(() => assertExecutedTests(tap));
  for (const summary of ['', tap.replace('# tests 1', '# tests 0'), tap.replace('# skipped 0', '# skipped 1'), tap.replace('# cancelled 0', '# cancelled 1'), tap.replace('# todo 0', '# todo 1')]) assert.throws(() => assertExecutedTests(summary), /required test suite/);
});

test('spawn failure is settled only after close, then frees its scope for cleanup', async () => {
  const child = new EventEmitter();
  const supervisor = createProcessSupervisor({ spawnProcess: () => child, platform: 'darwin', processGroupExists: () => false });
  const run = supervisor.run('missing-executable', [], {}, { scope: 'owned-database' });
  const rejected = assert.rejects(run, /ENOENT/);
  child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  assert.throws(() => supervisor.assertScopeStopped('owned-database'), /still running/);
  child.emit('close', null, null);
  await rejected;
  assert.doesNotThrow(() => supervisor.assertScopeStopped('owned-database'));
});

test('a closed parent keeps its database scope active until its remaining process group exits', async () => {
  const child = new EventEmitter();
  child.pid = 12345;
  let groupAlive = true;
  const signals = [];
  const supervisor = createProcessSupervisor({
    spawnProcess: () => child, platform: 'darwin', processGroupExists: () => groupAlive,
    terminationGraceMillis: 5, killGraceMillis: 100,
    killProcess(pid, signal) { signals.push([pid, signal]); if (signal === 'SIGKILL') groupAlive = false; },
  });
  const run = supervisor.run('npm', ['run', 'db:migrate'], {}, { scope: 'owned-template' });
  child.emit('close', 0, null);
  assert.throws(() => supervisor.assertScopeStopped('owned-template'), /still running/);
  await run;
  assert.deepEqual(signals, [[-child.pid, 'SIGTERM'], [-child.pid, 'SIGKILL']]);
  assert.doesNotThrow(() => supervisor.assertScopeStopped('owned-template'));
});

test('main executes default mandatory coverage and reports all phases once on success', async () => {
  const h = harness();
  const unitRuns = [];
  const originalRun = h.supervisor.run;
  h.supervisor.run = async (command, args, environment, options) => {
    if (!options.scope) {
      unitRuns.push({ command, args, environment, options });
      return;
    }
    return originalRun(command, args, environment, options);
  };
  await main([], h.dependencies);
  assert.equal(unitRuns.length, 1);
  assert.equal(unitRuns[0].options.requireExecutedTests, true);
  const selectedUnitTests = unitRuns[0].args.filter((argument) => argument.endsWith('.test.js'));
  assert.ok(selectedUnitTests.includes(__filename));
  assert.ok(selectedUnitTests.some((filename) => filename.includes('/email-tests/')));
  assert.ok(selectedUnitTests.every((filename) => !filename.endsWith('-integration.test.js')));
  assert.equal(unitRuns[0].environment.DATABASE_URL, 'postgres://test:test@127.0.0.1:1/nitewide_unit_no_database');
  assert.deepEqual(h.state.suites, INTEGRATION_TESTS);
  assert.equal(h.timing.reports, 1);
  assert.ok(h.timing.records.some((record) => record.phase === 'unit-tests' && !record.failed));
  assert.ok(h.timing.records.some((record) => record.phase === 'total' && !record.failed));
});

test('main reports suite and total failures after stopping and cleaning up the entire invocation', async () => {
  const h = harness({ failSuite: INTEGRATION_TESTS[0] });
  await assert.rejects(main(['--integration'], h.dependencies), /status 1/);
  assert.equal(h.timing.reports, 1);
  assert.equal(h.state.databases.size, 0);
  assert.ok(h.timing.records.some((record) => record.phase === 'total' && record.failed));
});

test('main reports failed total timings even when fail-closed option parsing stops execution', async () => {
  const timing = fakeTiming();
  await assert.rejects(main(['--concurrency', '3'], { timing }), /integer from 1 to 2/);
  assert.equal(timing.reports, 1);
  assert.deepEqual(timing.records, [{ phase: 'total', labels: {}, failed: true }]);
});

test('a CREATE collision after the existence check never becomes owned cleanup data', async () => {
  const queries = [];
  let ended = false;
  class FakeClient {
    async connect() {}
    async end() { ended = true; }
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith('SELECT datname')) return { rows: [] };
      if (sql.startsWith('CREATE DATABASE')) throw Object.assign(new Error('Concurrent generated-name collision'), { code: '42P04' });
      throw new Error('Unexpected mock operation');
    }
  }
  const manager = createTemplateDatabaseManager({
    ClientClass: FakeClient,
    environment: { TEST_DATABASE_ADMIN_URL: 'postgres://test:test@127.0.0.1:5433/postgres' },
    uuid: () => 'b'.repeat(32), migrationNames: ['required.js'],
    supervisor: { stopped: false, assertScopeStopped() {} },
    timing: { measure: (_phase, operation) => operation() }, log() {},
  });
  await assert.rejects(manager.prepare(() => { throw new Error('Migration must not start'); }), /collision/);
  assert.equal(manager.allocatedNames.length, 0);
  await manager.cleanup();
  assert.equal(ended, true);
  assert.equal(queries.some(sql => sql.startsWith('DROP DATABASE')), false);
});
