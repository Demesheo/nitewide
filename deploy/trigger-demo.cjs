#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const repository = 'Demesheo/nitewide';
const workflow = 'demo-image.yml';
const workflowUrl = `https://github.com/${repository}/actions/workflows/${workflow}`;
const help = `Start the Nitewide demo build and Render deploy from GitHub main.

Usage: npm run deploy:demo -- [--dry-run | --help]
       node deploy/trigger-demo.cjs [--dry-run | --help]

Uses GH_TOKEN / GITHUB_TOKEN when supplied, otherwise an authenticated GitHub CLI.
Requires repository Actions write permission. Never builds uncommitted local files.
Returns after dispatch; verify the workflow and Render health before sharing.
`;

async function run(args, { env = process.env, fetchImpl = fetch, spawn = spawnSync, log = console.log } = {}) {
  if (args.some(arg => !['--help', '--dry-run'].includes(arg))) {
    throw new Error('Unknown option. Use --help. Only the remote main branch can deploy this demo.');
  }
  if (args.includes('--help')) { log(help); return; }
  if (args.includes('--dry-run')) {
    log(`Would dispatch ${workflow} on ${repository}@main. No build or deployment started.`);
    log(workflowUrl);
    return;
  }
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (token) {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main' }),
      });
    } catch {
      throw new Error('GitHub dispatch did not return a confirmed result. Check Actions before retrying to avoid duplicate runs.');
    }
    if (!response.ok) throw new Error(`GitHub rejected dispatch (HTTP ${response.status}). Check repository access and Actions write permission.`);
  } else {
    const result = spawn('gh', ['workflow', 'run', workflow, '--repo', repository, '--ref', 'main'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, env,
    });
    if (result.error?.code === 'ENOENT') throw new Error('Install GitHub CLI and run gh auth login, or supply GH_TOKEN / GITHUB_TOKEN securely.');
    // Do not echo child output: authentication failures can contain sensitive details.
    if (result.error) throw new Error('GitHub CLI did not confirm dispatch. Check Actions before retrying.');
    if (result.status !== 0) throw new Error('GitHub CLI rejected dispatch. Check gh auth status and repository Actions write permission.');
  }
  log('Build-and-deploy workflow requested for remote main; deployment is not complete yet.');
  log(workflowUrl);
  log('Verify verify/publish/deploy jobs, then Render Live status and https://nitewide-demo.onrender.com/health.');
}

if (require.main === module) run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
