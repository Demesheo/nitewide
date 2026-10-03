const fs = require('node:fs');
const path = require('node:path');
const { resultsDirectory, ensureTimingRunId, summarize } = require('./test-timing.cjs');

function formatReports(reports) {
  if (!reports.length) return '### Test performance\n\nNo timing measurements were produced before this job stopped.\n';
  const sections = ['### Test performance', '', 'Durations include overlapping/nested phases and are not additive. Counts include retries.', ''];
  for (const report of reports.sort((a, b) => a.scope.localeCompare(b.scope))) {
    const phases = report.chunks ? summarize(Object.values(report.chunks).flat().map(record => ({ ...record, labels: {} }))) : report.phases;
    sections.push(`#### ${report.scope}`, '', '| Phase / fixture | Samples | Total (s) | p95 (s) | Failed |', '| --- | ---: | ---: | ---: | ---: |');
    for (const phase of phases.slice(0, 12)) {
      const label = [phase.phase, ...Object.values(phase.labels)].join(' · ');
      sections.push(`| ${label} | ${phase.count} | ${(phase.totalMs / 1000).toFixed(2)} | ${(phase.p95Ms / 1000).toFixed(2)} | ${phase.failed} |`);
    }
    sections.push('');
    const slowest = report.phases.filter(phase => phase.labels.suite || phase.labels.project).slice(0, 8);
    if (slowest.length) {
      sections.push('Slowest labeled phases:', '');
      for (const phase of slowest) sections.push(`- ${[phase.phase, ...Object.values(phase.labels)].join(' · ')}: ${(phase.maxMs / 1000).toFixed(2)}s max (${phase.count} samples)`);
      sections.push('');
    }
  }
  return sections.join('\n');
}
function readReports(directory = resultsDirectory, runId) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => /^test-timings-[a-z][a-z0-9-]*\.json$/.test(name)).map(name => {
    const report = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (report.version !== 1 || !Array.isArray(report.phases)) throw new Error('Unsupported timing report.');
    return report;
  }).filter(report => !runId || report.runId === runId);
}
function main() {
  const runId = process.env.CI === 'true' ? ensureTimingRunId() : undefined;
  const markdown = formatReports(readReports(resultsDirectory, runId));
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
}
if (require.main === module) main();
module.exports = { formatReports, readReports };
