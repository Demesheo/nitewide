#!/usr/bin/env node
const { createCommandRunner } = require('./test-command.cjs');
const { createTimingCollector } = require('./test-timing.cjs');

async function runRelease({ runner, timing }) {
  await timing.measure('test', () => runner.npm(['test'], { labels: { suite: 'release-node' } }), { suite: 'release-node' });
  await timing.measure('test', () => runner.npm(['run', 'test:e2e'], { labels: { suite: 'release-browser' } }), { suite: 'release-browser' });
}
async function main(args = process.argv.slice(2)) {
  if (args.length) throw new Error('test:release does not accept filters; complete Node and browser verification is required.');
  const timing = createTimingCollector('release');
  const runner = createCommandRunner({ timing });
  try { await runRelease({ runner, timing }); }
  catch (error) { process.exitCode = runner.exitCode; throw error; }
  finally { runner.dispose(); timing.report(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode ||= 1; });
module.exports = { runRelease, main };
