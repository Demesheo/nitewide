const { spawnSync } = require('node:child_process');

// A staging-only default for later Render environment/manual redeploys.
// Normal rollouts still use immutable digest overrides, not this mutable tag.
function settings(env) {
  if (env.GITHUB_REPOSITORY !== 'Demesheo/nitewide' || env.GITHUB_REF !== 'refs/heads/staging'
    || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) throw new Error('Alias promotion requires this repository staging branch');
  if (env.STAGING_ROLLOUT_RESULT !== 'success') throw new Error('Alias promotion requires a successful staging API/worker rollout');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('A verified commit SHA is required');
  if (env.IMAGE !== 'ghcr.io/demesheo/nitewide' || !/^sha256:[a-f0-9]{64}$/.test(env.DIGEST || '')) throw new Error('A verified staging image digest is required');
  return { revision: env.GITHUB_SHA, digest: env.DIGEST, source: `${env.IMAGE}@${env.DIGEST}`, alias: `${env.IMAGE}:staging-verified` };
}

function run(env = process.env, { spawn = spawnSync, log = console.log } = {}) {
  const config = settings(env);
  function execute(command, args, failure, timeout = 120000) {
    let result;
    try { result = spawn(command, args, { encoding: 'utf8', stdio: 'pipe', timeout, maxBuffer: 1024 * 1024 }); }
    catch { throw new Error(failure); }
    // Provider output can contain credentials or private diagnostics. Never
    // include it in a message, including uncertain/time-out promotion results.
    if (!result || result.error || result.status !== 0) throw new Error(failure);
    return result.stdout || '';
  }
  const head = execute('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/staging'],
    'Cannot verify the current staging branch; alias unchanged', 30000).trim();
  const match = head.match(/^([a-f0-9]{40})\s+refs\/heads\/staging$/);
  if (!match) throw new Error('Cannot verify the current staging branch; alias unchanged');
  if (match[1] !== config.revision) {
    log('A newer staging commit exists; leaving staging-verified unchanged.');
    return { promoted: false };
  }
  const failure = 'Staging is already deployed, but alias promotion is unverified; inspect the registry before retrying. No automatic rollback.';
  execute('docker', ['buildx', 'imagetools', 'create', '--prefer-index=false', '--tag', config.alias, config.source], failure);
  const inspected = execute('docker', ['buildx', 'imagetools', 'inspect', '--format', '{{json .Manifest}}', config.alias], failure);
  let manifest;
  try { manifest = JSON.parse(inspected); } catch { throw new Error(failure); }
  if (manifest?.digest !== config.digest) throw new Error(failure);
  log(`Staging default ${config.alias} verified at ${config.digest} for ${config.revision}`);
  return { promoted: true, digest: config.digest };
}
if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { settings, run };
