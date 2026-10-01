const { spawn } = require('node:child_process');
const path = require('node:path');
const { isolatedEnvironment, frontendBuildEnvironment } = require('./environment.cjs');
const root = path.resolve(__dirname, '..');
const environment = isolatedEnvironment('postgres://test:test@127.0.0.1:1/nitewide_unused');
function validateArguments(args) {
  if (args.some(arg => /^(?:--config(?:=|$)|-c|--workers(?:=|$)|-j|--fully-parallel(?:=|$)|--repeat-each(?:=|$)|--output(?:=|$))/.test(arg))) {
    throw new Error('Use the fixed Playwright configuration and single worker. Custom targets or concurrent fixture resets are forbidden.');
  }
  return args;
}
function run(command, args, { buildFrontend = false } = {}) {
  return new Promise((resolve, reject) => {
    const handle = spawn(command, args, { cwd: root, env: buildFrontend ? frontendBuildEnvironment() : environment, stdio: 'inherit' });
    const stop = signal => handle.kill(signal);
    const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    handle.once('error', reject);
    handle.once('exit', code => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
      code === 0 ? resolve() : reject(new Error(`Command failed (${code})`));
    });
  });
}
async function build() { await run(process.env.npm_execpath ? process.execPath : 'npm', process.env.npm_execpath ? [process.env.npm_execpath, 'run', 'build'] : ['run', 'build'], { buildFrontend: true }); }
if (require.main === module) (async () => {
  const args = validateArguments(process.argv.slice(2));
  await build();
  await run(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...args]);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run, build, validateArguments };
