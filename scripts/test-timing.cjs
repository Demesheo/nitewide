const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');

// Playwright clears test-results at startup. Keep setup/API measurements outside
// that directory so a complete release run retains every layer's timings.
const resultsDirectory = path.resolve(__dirname, '../.test-metrics');
const labelKeys = new Set(['suite', 'project', 'app', 'role', 'status']);

function ensureTimingRunId(environment = process.env) {
  if (environment.NITEWIDE_TEST_TIMING_RUN_ID && !/^[a-f0-9]{32}$/.test(environment.NITEWIDE_TEST_TIMING_RUN_ID)) {
    throw new Error('Test timing run IDs must be generated hexadecimal identifiers.');
  }
  const ciRun = environment.CI === 'true' && environment.GITHUB_RUN_ID && environment.GITHUB_JOB
    ? [environment.GITHUB_RUN_ID, environment.GITHUB_RUN_ATTEMPT || '1', environment.GITHUB_JOB,
      environment.PLAYWRIGHT_PROJECT_GROUP || ''].join(':') : null;
  return environment.NITEWIDE_TEST_TIMING_RUN_ID ||= ciRun
    ? createHash('sha256').update(ciRun).digest('hex').slice(0, 32) : randomUUID().replaceAll('-', '');
}

function summarize(records) {
  const phases = new Map();
  for (const item of records) {
    const key = JSON.stringify([item.phase, item.labels]);
    const group = phases.get(key) || { phase: item.phase, labels: item.labels, durations: [], failed: 0 };
    group.durations.push(item.durationMs);
    group.failed += Number(item.failed);
    phases.set(key, group);
  }
  return [...phases.values()].map(({ durations, ...group }) => {
    durations.sort((a, b) => a - b);
    const totalMs = durations.reduce((sum, value) => sum + value, 0);
    return { ...group, count: durations.length, totalMs, averageMs: totalMs / durations.length,
      p95Ms: durations[Math.ceil(durations.length * 0.95) - 1], maxMs: durations.at(-1) };
  }).sort((a, b) => b.totalMs - a.totalMs);
}

function createTimingCollector(scope, { now = () => performance.now(), environment = process.env,
  read = filename => fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null,
  write = (filename, value) => {
    fs.mkdirSync(resultsDirectory, { recursive: true });
    const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(temporary, filename);
  }, output = console.log } = {}) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(scope)) throw new Error('Invalid test timing scope.');
  const runId = ensureTimingRunId(environment);
  const collectorId = `${process.pid}-${randomUUID()}`;
  const records = [];
  function record(phase, durationMs, labels = {}, failed = false) {
    if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(phase) || !Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('Invalid test timing phase or duration.');
    }
    const safeLabels = {};
    for (const key of Object.keys(labels).sort()) {
      const value = labels[key];
      if (!labelKeys.has(key) || typeof value !== 'string' || !/^[a-zA-Z0-9 _./:-]{1,180}$/.test(value)) {
        throw new Error('Test timings accept only non-sensitive static labels.');
      }
      safeLabels[key] = value;
    }
    records.push({ phase, durationMs, labels: safeLabels, failed: Boolean(failed) });
  }
  async function measure(phase, operation, labels = {}) {
    const started = now();
    let failed = true;
    try { const result = await operation(); failed = false; return result; }
    finally { record(phase, Math.max(0, now() - started), labels, failed); }
  }
  function report() {
    const filename = path.join(resultsDirectory, `test-timings-${scope}.json`);
    const previous = read(filename);
    const chunks = previous?.runId === runId && previous.scope === scope ? { ...previous.chunks } : {};
    // A restarted browser worker adds its own chunk; reporting twice from the
    // same collector replaces its snapshot rather than double-counting it.
    chunks[collectorId] = records;
    const combined = Object.values(chunks).flat();
    const report = { version: 1, runId, scope, chunks, measurements: combined.length, phases: summarize(combined) };
    write(filename, report);
    output(`[test-timing] ${scope}: ${combined.length} measurements saved to ${path.relative(path.resolve(__dirname, '..'), filename)}`);
    return report;
  }
  return { runId, record, measure, report };
}

module.exports = { createTimingCollector, ensureTimingRunId, summarize, resultsDirectory };
