const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { maintenanceUrl } = require('../apps/api/scripts/test-database.cjs');

// This container is only for tests. Never use its browser libraries in the
// deployable image or forward ambient provider keys into it.
function containerPlan({ source = process.env, workspace = path.resolve(__dirname, '..'),
  nodeExecutable = fs.realpathSync(process.execPath), platform = process.platform,
  version = require('@playwright/test/package.json').version } = {}) {
  if (platform !== 'linux' || source.CI !== 'true') throw new Error('The browser container runner requires Linux CI; use npm run test:e2e locally.');
  const expectedImage = `mcr.microsoft.com/playwright:v${version}-noble`;
  if (source.PLAYWRIGHT_CONTAINER_IMAGE !== expectedImage) throw new Error(`Pin PLAYWRIGHT_CONTAINER_IMAGE to ${expectedImage} to match the installed Playwright version.`);
  if (!path.isAbsolute(workspace) || !path.isAbsolute(nodeExecutable) || [workspace, nodeExecutable].some(value => /[,\n\r]/.test(value))) throw new Error('Container mounts require safe absolute paths.');
  const nodeRoot = path.dirname(path.dirname(nodeExecutable));
  const databaseUrl = maintenanceUrl(source);
  const projectGroup = source.PLAYWRIGHT_PROJECT_GROUP;
  if (projectGroup && !['customer', 'business', 'admin-rebuild'].includes(projectGroup)) throw new Error('Select a supported browser project group: customer, business, or admin-rebuild.');
  const projectArguments = projectGroup ? ['--', `--project=${projectGroup}-iphone`, `--project=${projectGroup}-desktop`] : [];
  return { image: expectedImage, args: [
    'run', '--rm', '--pull=never', '--init', '--ipc=host', '--network=host',
    '--mount', `type=bind,source=${workspace},target=${workspace}`,
    // Use the exact setup-node runtime and npm installation, not the image's
    // potentially different bundled Node. Host and test image both use Noble.
    '--mount', `type=bind,source=${nodeRoot},target=${nodeRoot},readonly`,
    '--workdir', workspace,
    '--env', `PATH=${nodeRoot}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    '--env', 'CI=true', '--env', 'NODE_ENV=test',
    '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    '--env', `TEST_DATABASE_ADMIN_URL=${databaseUrl}`,
    expectedImage, 'npm', 'run', 'test:e2e', ...projectArguments,
  ] };
}

async function main(args = process.argv.slice(2)) {
  if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Only --check is supported.');
  const plan = containerPlan();
  if (args[0] === '--check') { console.log(`Browser image matches Playwright: ${plan.image}`); return; }
  await new Promise((resolve, reject) => {
    const child = spawn('docker', plan.args, { stdio: 'inherit' });
    const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    const cleanup = () => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { cleanup(); code === 0 ? resolve() : reject(new Error(`Browser container failed (${code}).`)); });
  });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { containerPlan };
