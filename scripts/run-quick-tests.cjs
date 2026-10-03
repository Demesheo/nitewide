#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { root, quickEnvironment, createCommandRunner } = require('./test-command.cjs');
const { createTimingCollector } = require('./test-timing.cjs');

function frontendWorkspaces() {
  return fs.readdirSync(path.join(root, 'apps'), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'api')
    .flatMap(entry => {
      const file = path.join(root, 'apps', entry.name, 'package.json');
      return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).scripts?.test ? [entry.name] : [];
    }).sort();
}

async function runQuick({ runner, timing, apps = frontendWorkspaces(), apiUnit = true }) {
  for (const app of apps) await timing.measure('test', () => runner.npm(['test', '--workspace', `@nitewide/${app}`], {
    env: quickEnvironment(), labels: { suite: 'frontend-unit', app },
  }), { suite: 'frontend-unit', app });
  if (apiUnit) await timing.measure('test', () => runner.run(process.execPath, ['apps/api/scripts/run-tests.cjs', '--unit'], {
    env: quickEnvironment(), labels: { suite: 'api-unit', app: 'api' },
  }), { suite: 'api-unit', app: 'api' });
}

async function main(args = process.argv.slice(2)) {
  if (args.length) throw new Error('test:quick does not accept filters; it runs every frontend unit/component test and API unit test.');
  const timing = createTimingCollector('quick');
  const runner = createCommandRunner({ timing, env: quickEnvironment() });
  try { await runQuick({ runner, timing }); }
  catch (error) { process.exitCode = runner.exitCode; throw error; }
  finally { runner.dispose(); timing.report(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode ||= 1; });
module.exports = { frontendWorkspaces, runQuick, main };
