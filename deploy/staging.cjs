// Run only after CI publishes the exact verified image. Hooks are narrowly
// scoped to staging services; no Render account credential is needed in CI.
function settings(env) {
  if (env.GITHUB_REF !== 'refs/heads/staging' || env.GITHUB_EVENT_NAME === 'pull_request') throw new Error('Deployment requires the staging branch');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('A verified commit SHA is required');
  if (env.IMAGE !== 'ghcr.io/demesheo/nitewide' || !/^sha256:[a-f0-9]{64}$/.test(env.DIGEST || '')) throw new Error('A verified release image digest is required');
  const hooks = {};
  for (const role of ['API', 'WORKER']) {
    const id = env[`STAGING_${role}_SERVICE_ID`];
    if (!/^srv-[a-z0-9]+$/.test(id || '')) throw new Error(`Configure STAGING_${role}_SERVICE_ID`);
    let url;
    try { url = new URL(env[`RENDER_STAGING_${role}_DEPLOY_HOOK`]); } catch { throw new Error(`Configure RENDER_STAGING_${role}_DEPLOY_HOOK`); }
    if (url.origin !== 'https://api.render.com' || url.pathname !== `/deploy/${id}` || !url.searchParams.get('key')
      || [...url.searchParams.keys()].some(key => key !== 'key') || url.username || url.password || url.hash) throw new Error(`Invalid staging ${role} deploy hook`);
    url.searchParams.set('imgURL', `${env.IMAGE}@${env.DIGEST}`);
    hooks[role] = url;
  }
  if (env.STAGING_API_SERVICE_ID === env.STAGING_WORKER_SERVICE_ID) throw new Error('API and worker must be separate staging services');
  let ready;
  try { ready = new URL(env.STAGING_READINESS_URL); } catch { throw new Error('Configure STAGING_READINESS_URL'); }
  if (ready.protocol !== 'https:' || ready.port || ready.username || ready.password || ready.hash || ready.search
    || ready.pathname !== '/health/ready' || !(ready.hostname.endsWith('.onrender.com') || ready.hostname === 'staging.nitewide.com')) throw new Error('Invalid staging readiness URL');
  return { hooks, ready, revision: env.GITHUB_SHA };
}

async function run(env = process.env, { fetchImpl = fetch, log = console.log, now = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 600000 } = {}) {
  const config = settings(env);
  async function requestDeploy(role) {
    let response;
    try { response = await fetchImpl(config.hooks[role], { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error(`Staging ${role} deploy result is uncertain; inspect Render before retrying`); }
    if (![200, 202].includes(response.status)) throw new Error(`Staging ${role} deploy rejected (HTTP ${response.status})`);
    // Never log the secret URL or provider response body. A 202 means queued,
    // not deployed: only exact-release readiness below can finish this job.
    log(`Staging ${role} deployment requested for ${config.revision}`);
  }
  async function waitReady(requireWorker) {
    const url = new URL(config.ready);
    if (requireWorker) url.searchParams.set('requireWorker', 'true');
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      try {
        const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (response.status === 200 && response.headers.get('x-nitewide-revision') === config.revision
          && response.headers.get('x-nitewide-environment') === 'staging') {
          const body = await response.json();
          if (body.status === 'ok' && body.service === 'nitewide-api') return;
        }
      } catch { /* A restarting or unavailable service remains unverified. */ }
      await pause(10000);
    }
    throw new Error(`Timed out verifying staging ${requireWorker ? 'API/worker parity' : 'API readiness'} for ${config.revision}; inspect Render`);
  }
  await requestDeploy('API');
  await waitReady(false); // API pre-deploy applies migrations before worker start.
  await requestDeploy('WORKER');
  await waitReady(true); // Fresh worker heartbeat must match revision and config.
  log(`Staging API and worker verified at ${config.revision}`);
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { settings, run };
