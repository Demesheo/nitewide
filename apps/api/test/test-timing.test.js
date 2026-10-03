const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimingCollector, ensureTimingRunId, summarize } = require('../../../scripts/test-timing.cjs');
const { phasePlan } = require('../../../scripts/time-test-phase.cjs');
const { formatReports } = require('../../../scripts/report-test-timings.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('timing records preserve success results and original failures without sensitive labels', async () => {
  let clock = 1, stored;
  const collector = createTimingCollector('test', { now: () => clock, environment: {}, read: () => null,
    write: (_filename, report) => { stored = report; }, output: () => {} });
  assert.equal(await collector.measure('seed', () => { clock = 6; return 'fixture'; }, { suite: 'safe.test.js' }), 'fixture');
  const failure = new Error('provider data must not enter the report');
  await assert.rejects(collector.measure('migration', () => { clock = 10; throw failure; }), error => error === failure);
  collector.report();
  assert.equal(stored.measurements, 2);
  assert.equal(stored.phases[0].phase, 'seed');
  assert.equal(stored.phases[0].totalMs, 5);
  assert.equal(stored.phases[1].failed, 1);
  assert.doesNotMatch(JSON.stringify(stored), /provider data/);
  assert.throws(() => collector.record('auth', 1, { token: 'secret' }), /static labels/);
  assert.throws(() => collector.record('auth', 1, { role: 'customer@example.com' }), /static labels/);
  assert.throws(() => collector.record('postgres://secret', 1), /Invalid test timing/);
});

test('same-run worker reports merge, repeated reports replace snapshots and new runs discard stale measurements', () => {
  let stored;
  const environment = {};
  const options = { environment, read: () => stored, write: (_filename, report) => { stored = report; }, output: () => {} };
  const first = createTimingCollector('browser-fixtures', options);
  first.record('reset', 4); first.report(); first.report();
  assert.equal(stored.measurements, 1);
  const second = createTimingCollector('browser-fixtures', options);
  second.record('reset', 6); second.report();
  assert.equal(stored.measurements, 2);
  assert.equal(stored.phases[0].totalMs, 10);
  const next = createTimingCollector('browser-fixtures', { ...options, environment: {} });
  next.record('reset', 2); next.report();
  assert.equal(stored.measurements, 1);
  assert.equal(stored.phases[0].totalMs, 2);
});

test('timing summaries expose counts, failed samples and p95 without treating nested phases as wall time', () => {
  const records = [1, 2, 3, 40].map(durationMs => ({ phase: 'reset', durationMs, labels: {}, failed: durationMs === 40 }));
  assert.deepEqual(summarize(records), [{ phase: 'reset', labels: {}, failed: 1, count: 4, totalMs: 46,
    averageMs: 11.5, p95Ms: 40, maxMs: 40 }]);
  assert.throws(() => ensureTimingRunId({ NITEWIDE_TEST_TIMING_RUN_ID: '../../outside' }), /identifiers/);
  assert.throws(() => createTimingCollector('../outside'), /scope/);
});

test('CI steps share a timing ID but separate lanes and workflow attempts cannot mix reports', () => {
  const source = { CI: 'true', GITHUB_RUN_ID: '123', GITHUB_JOB: 'browser', GITHUB_RUN_ATTEMPT: '1', PLAYWRIGHT_PROJECT_GROUP: 'customer-core' };
  assert.equal(ensureTimingRunId({ ...source }), ensureTimingRunId({ ...source }));
  assert.notEqual(ensureTimingRunId({ ...source }), ensureTimingRunId({ ...source, PLAYWRIGHT_PROJECT_GROUP: 'business-core' }));
  assert.notEqual(ensureTimingRunId({ ...source }), ensureTimingRunId({ ...source, GITHUB_RUN_ATTEMPT: '2' }));
  assert.notEqual(ensureTimingRunId({}), ensureTimingRunId({}));
});

test('setup timing commands are fixed and summaries label overlapping phases', () => {
  assert.deepEqual(phasePlan('npm-version'), ['npm', ['install', '--global', 'npm@12.1.0']]);
  assert.deepEqual(phasePlan('dependencies'), ['npm', ['ci']]);
  assert.deepEqual(phasePlan('browser-pull', { PLAYWRIGHT_CONTAINER_IMAGE: 'mcr.microsoft.com/playwright:v1.63.0-noble' }),
    ['docker', ['pull', 'mcr.microsoft.com/playwright:v1.63.0-noble']]);
  assert.throws(() => phasePlan('browser-pull', { PLAYWRIGHT_CONTAINER_IMAGE: 'untrusted; echo token' }), /pinned/);
  assert.throws(() => phasePlan('arbitrary-command'), /supported/);
  assert.match(formatReports([]), /No timing measurements/);
  const phases = summarize([{ phase: 'clone', durationMs: 125, labels: {}, failed: false }]);
  const markdown = formatReports([{ scope: 'api', phases }]);
  assert.match(markdown, /overlapping\/nested/);
  assert.match(markdown, /clone \| 1 \| 0\.13 \| 0\.13 \| 0/);
});

test('CI bootstrap runner requires no installed packages when an explicit environment is supplied', () => {
  const loaded = { exports: {} };
  const filename = path.resolve(__dirname, '../../../scripts/test-command.cjs');
  const required = [];
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: loaded, __dirname: path.dirname(filename), process, setTimeout, clearTimeout,
    require(name) { required.push(name); assert.ok(name.startsWith('node:'), 'pre-install bootstrap may load only built-ins'); return require(name); },
  });
  const runner = loaded.exports.createCommandRunner({ env: { NODE_ENV: 'test' }, signalSource: new EventEmitter() });
  runner.dispose();
  assert.deepEqual(required, ['node:child_process', 'node:path']);
});
