const { createTimingCollector } = require('./test-timing.cjs');
const { createCommandRunner } = require('./test-command.cjs');

function phasePlan(phase, source = process.env) {
  if (phase === 'npm-version') return ['npm', ['install', '--global', 'npm@12.1.0']];
  if (phase === 'dependencies') return ['npm', ['ci']];
  if (phase === 'browser-pull') {
    if (!/^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble$/.test(source.PLAYWRIGHT_CONTAINER_IMAGE || '')) {
      throw new Error('Browser image timing requires the pinned Playwright image.');
    }
    return ['docker', ['pull', source.PLAYWRIGHT_CONTAINER_IMAGE]];
  }
  throw new Error('Select a supported CI timing phase.');
}
async function main(args = process.argv.slice(2)) {
  if (args.length !== 1) throw new Error('Select one CI timing phase.');
  const [command, commandArgs] = phasePlan(args[0]);
  const timing = createTimingCollector('ci-setup');
  const runner = createCommandRunner({ env: process.env });
  try {
    await timing.measure(`ci.${args[0]}`, () => runner.run(command, commandArgs));
  } catch (error) {
    process.exitCode = runner.exitCode;
    throw error;
  } finally { runner.dispose(); timing.report(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode ||= 1; });
module.exports = { phasePlan };
