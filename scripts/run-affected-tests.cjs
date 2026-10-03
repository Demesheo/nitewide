#!/usr/bin/env node
const path = require('node:path');
const { createCommandRunner } = require('./test-command.cjs');
const { createTimingCollector } = require('./test-timing.cjs');
const { runQuick, frontendWorkspaces } = require('./run-quick-tests.cjs');

const projectsByApp = Object.freeze({ customer: ['customer-iphone', 'customer-desktop'], business: ['business-iphone', 'business-desktop'], admin: ['admin-rebuild-iphone', 'admin-rebuild-desktop'] });
const specsByApp = Object.freeze({ customer: ['customer.spec.cjs', 'customer-my-events.spec.cjs', 'commissions-messages.spec.cjs'],
  business: ['business.spec.cjs', 'business-access.spec.cjs', 'business-payments.spec.cjs', 'commissions-messages.spec.cjs'],
  admin: ['admin-rebuild.spec.cjs', 'admin-access-requests.spec.cjs'] });

function parseOptions(args = []) {
  let base = null, dryRun = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dry-run' && !dryRun) dryRun = true;
    else if (args[index] === '--base' && !base) {
      base = args[++index];
      if (!base || !/^[a-zA-Z0-9][a-zA-Z0-9_./@~^+-]*$/.test(base)) throw new Error('--base requires a Git commit or branch name.');
    } else throw new Error('Use test:affected [--base <commit-or-branch>] [--dry-run].');
  }
  return { base, dryRun };
}

async function changedFiles(runner, base) {
  // Treat a rename as deletion + addition so both source consumers are covered.
  const captures = [await runner.run('git', ['diff', '--no-renames', '--name-only', '-z', 'HEAD', '--'], { capture: true, labels: { suite: 'selection' } }),
    await runner.run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { capture: true, labels: { suite: 'selection' } })];
  if (base) {
    const commit = (await runner.run('git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { capture: true, labels: { suite: 'selection' } })).trim();
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('The base did not resolve to a Git commit.');
    captures.push(await runner.run('git', ['diff', '--no-renames', '--name-only', '-z', `${commit}...HEAD`, '--'], { capture: true, labels: { suite: 'selection' } }));
  }
  return [...new Set(captures.flatMap(value => value.split('\0').filter(Boolean)))].sort();
}

function selectAffected(files, { ci = Boolean(process.env.CI) } = {}) {
  const frontendApps = new Set(), projects = new Set(), specs = new Set(), reasons = [];
  let release = ci;
  if (ci) reasons.push('CI always requires complete release verification.');
  const addBrowserApp = app => { for (const project of projectsByApp[app]) projects.add(project); for (const spec of specsByApp[app]) specs.add(spec); };
  for (const file of [...new Set(files)].sort()) {
    if (file.startsWith('/') || file.includes('\\') || file !== path.posix.normalize(file) || file.startsWith('../')) {
      release = true; reasons.push(`${JSON.stringify(file)}: unsafe or unknown path; complete release verification.`); continue;
    }
    const frontend = file.match(/^apps\/(customer|business|admin)\/(src\/|public\/|index\.html$)/);
    const testOnly = file.match(/^apps\/(customer|business|admin)\/test\/.*\.(?:js|jsx|cjs)$/);
    if (frontend) {
      const app = frontend[1], source = file.startsWith(`apps/${app}/src/`);
      // App source imports form a cycle: Admin reuses Business editors, Business
      // reuses Admin venue UI and Customer styles, Customer reuses commissions.
      const consumers = source ? Object.keys(projectsByApp) : app === 'admin' ? ['admin'] : ['customer', 'business'];
      for (const consumer of source ? consumers : [app]) frontendApps.add(consumer);
      for (const dependent of consumers) addBrowserApp(dependent);
      reasons.push(`${JSON.stringify(file)}: ${source ? 'all frontend units/components and both devices for shared app source consumers' : `${app} unit/components and both devices for ${consumers.join(' + ')} journeys`}.`);
    } else if (testOnly) {
      frontendApps.add(testOnly[1]); reasons.push(`${JSON.stringify(file)}: every ${testOnly[1]} unit/component test.`);
    } else if (/^e2e\/specs\/[^/]+\.spec\.cjs$/.test(file)) {
      const spec = path.posix.basename(file);
      const apps = Object.keys(specsByApp).filter(app => specsByApp[app].includes(spec));
      if (!apps.length) { release = true; reasons.push(`${JSON.stringify(file)}: unmapped browser spec; complete release verification.`); }
      else {
        specs.add(spec); for (const app of apps) for (const project of projectsByApp[app]) projects.add(project);
        reasons.push(`${JSON.stringify(file)}: configured ${apps.join(' + ')} phone and desktop projects for this spec.`);
      }
    } else {
      release = true; reasons.push(`${JSON.stringify(file)}: API/shared/schema/configuration/deployment or unknown dependency; complete release verification.`);
    }
  }
  if (!files.length) reasons.push('No changed files: every frontend unit/component test and API unit test.');
  return { mode: release ? 'release' : files.length ? 'selected' : 'quick',
    frontendApps: [...frontendApps].sort(), apiUnit: true, projects: [...projects].sort(), specs: [...specs].sort(), reasons };
}

async function runAffected(plan, { runner, timing }) {
  if (plan.mode === 'release') return timing.measure('test', () => runner.npm(['run', 'test:release'], { labels: { suite: 'release-fallback' } }), { suite: 'release-fallback' });
  await runQuick({ runner, timing, apps: plan.mode === 'quick' ? frontendWorkspaces() : plan.frontendApps, apiUnit: true });
  if (plan.projects.length) await timing.measure('test', () => runner.npm(['run', 'test:e2e', '--',
    ...plan.projects.map(project => `--project=${project}`), ...plan.specs.map(spec => `e2e/specs/${spec}`)], { labels: { suite: 'affected-browser' } }), { suite: 'affected-browser' });
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const timing = createTimingCollector('affected');
  const runner = createCommandRunner({ timing });
  try {
    let plan;
    try { plan = selectAffected(await changedFiles(runner, options.base)); }
    catch (error) {
      if (runner.interrupted) throw error;
      plan = { mode: 'release', reasons: ['Git change discovery failed; complete release verification.'] };
    }
    console.log(`Affected selection: ${plan.mode}${options.dryRun ? ' (dry run; no verification executed)' : ''}`);
    for (const reason of plan.reasons) console.log(`  ${reason}`);
    if (!options.dryRun) await runAffected(plan, { runner, timing });
    return plan;
  } catch (error) { process.exitCode = runner.exitCode; throw error; }
  finally { runner.dispose(); timing.report(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode ||= 1; });
module.exports = { projectsByApp, specsByApp, parseOptions, changedFiles, selectAffected, runAffected, main };
