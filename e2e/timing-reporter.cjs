const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createTimingCollector } = require('../scripts/test-timing.cjs');

class TimingReporter {
  constructor() {
    this.timing = createTimingCollector('browser-tests');
    this.started = performance.now();
  }
  onTestEnd(test, result) {
    // File/line identifies a slow journey without storing its user data, title,
    // attachments, request bodies, or failure details in performance reports.
    this.timing.record('test.attempt', result.duration, {
      suite: `${path.basename(test.location.file)}:${test.location.line}`,
      project: test.parent.project().name,
      status: result.status,
    }, !['passed', 'skipped'].includes(result.status));
  }
  onEnd(result) {
    this.timing.record('browser.wall', Math.max(0, performance.now() - this.started),
      { status: result.status }, result.status !== 'passed');
    this.timing.report();
  }
}
module.exports = TimingReporter;
