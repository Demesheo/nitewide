const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { containerPlan, projectGroups } = require('../../../e2e/ci-container.cjs');
const root = path.resolve(__dirname, '../../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/demo-image.yml'), 'utf8');
const section = name => {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `Missing ${name} job`); return match[1];
};
const source = { CI: 'true', PLAYWRIGHT_CONTAINER_IMAGE: 'mcr.microsoft.com/playwright:v1.63.0-noble', TEST_DATABASE_ADMIN_URL: 'postgres://test:test@localhost:5432/postgres', RESEND_API_KEY: 'never-forward', GITHUB_TOKEN: 'never-forward', DATABASE_URL: 'postgres://live:secret@live.example/nitewide' };
const options = { source, workspace: '/workspace/nitewide', nodeExecutable: '/opt/node/24.21.0/bin/node', platform: 'linux', version: '1.63.0' };

test('CI browser image must match installed Playwright exactly', () => {
  assert.equal(containerPlan(options).image, source.PLAYWRIGHT_CONTAINER_IMAGE);
  assert.throws(() => containerPlan({ ...options, version: '1.64.0' }), /match the installed Playwright/);
  const installed = require('@playwright/test/package.json').version;
  assert.match(section('browser'), new RegExp(`mcr.microsoft.com/playwright:v${installed.replaceAll('.', '\\.')}-noble`));
  assert.doesNotMatch(workflow, /playwright install|apt-get/);
});

test('browser container preserves loopback isolation, sequential tests and exact Node runtime', () => {
  const { args } = containerPlan(options);
  assert.ok(args.includes('--network=host')); assert.ok(args.includes('--init')); assert.ok(args.includes('--ipc=host'));
  assert.ok(args.includes('type=bind,source=/opt/node/24.21.0,target=/opt/node/24.21.0,readonly'));
  assert.ok(args.includes('TEST_DATABASE_ADMIN_URL=postgres://test:test@localhost:5432/postgres'));
  assert.ok(args.includes('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'));
  assert.deepEqual(args.slice(-3), ['npm', 'run', 'test:e2e']);
  assert.doesNotMatch(args.join(' '), /never-forward|live\.example|--workers|--privileged|docker\.sock/);
  assert.throws(() => containerPlan({ ...options, source: { ...source, TEST_DATABASE_ADMIN_URL: 'postgres://live:secret@live.example/postgres' } }), /loopback/i);
  assert.throws(() => containerPlan({ ...options, source: { ...source, TEST_DATABASE_ADMIN_URL: 'postgres://test:test@localhost:5432/nitewide' } }), /maintenance/i);
  assert.throws(() => containerPlan({ ...options, platform: 'darwin' }), /Linux CI/);
  assert.throws(() => containerPlan({ ...options, source: { ...source, CI: '' } }), /Linux CI/);
  assert.throws(() => containerPlan({ ...options, workspace: '/workspace,unsafe' }), /safe absolute/);
});

test('CI balances four file partitions while keeping every device/spec pair exactly once', () => {
  const groups = ['customer-core', 'business-core', 'business-operations', 'platform-operations'];
  assert.match(section('browser'), /app: \[customer-core, business-core, business-operations, platform-operations\]/);
  assert.match(section('browser'), /fail-fast: false/);
  assert.match(section('browser'), /group: demo-browser-\$\{\{ matrix\.app \}\}-\$\{\{ github\.ref \}\}/);
  assert.match(section('browser'), /PLAYWRIGHT_PROJECT_GROUP: \$\{\{ matrix\.app \}\}/);
  assert.match(section('browser'), /name: playwright-results-\$\{\{ matrix\.app \}\}/);
  assert.match(section('browser'), /services:\s+postgres:/);
  const config = require('../../../playwright.config.cjs');
  const coverage = [];
  for (const group of groups) {
    const { args } = containerPlan({ ...options, source: { ...source, PLAYWRIGHT_PROJECT_GROUP: group } });
    const { apps, specs: files } = projectGroups[group];
    assert.deepEqual(args.slice(args.indexOf('npm')), ['npm', 'run', 'test:e2e', '--',
      ...apps.flatMap(app => [`--project=${app}-iphone`, `--project=${app}-desktop`]), ...files.map(file => `e2e/specs/${file}`)]);
    assert.doesNotMatch(args.join(' '), /never-forward|live\.example|--workers|--fully-parallel/);
    for (const project of config.projects.filter(project => apps.some(app => project.name.startsWith(`${app}-`)))) {
      for (const file of project.testMatch.filter(file => !files.length || files.includes(file))) {
        coverage.push(`${project.name}:${file}`);
      }
    }
  }
  const expected = config.projects.flatMap(project => project.testMatch.map(file => `${project.name}:${file}`));
  assert.deepEqual(coverage.sort(), expected.sort(), 'Every configured device/spec pair runs exactly once');
  assert.equal(new Set(coverage).size, coverage.length, 'No duplicated device/spec executions');
  assert.deepEqual(projectGroups['business-operations'].apps, ['business', 'customer']);
  assert.ok(projectGroups['business-operations'].specs.includes('customer-my-events.spec.cjs'));
  assert.deepEqual(projectGroups['platform-operations'], { apps: ['admin-rebuild'], specs: ['admin-rebuild.spec.cjs', 'admin-access-requests.spec.cjs'] });
  const legacy = containerPlan({ ...options, source: { ...source, PLAYWRIGHT_PROJECT_GROUP: 'customer' } });
  assert.deepEqual(legacy.args.slice(-6), ['npm', 'run', 'test:e2e', '--', '--project=customer-iphone', '--project=customer-desktop']);
  assert.throws(() => containerPlan({ ...options, source: { ...source, PLAYWRIGHT_PROJECT_GROUP: 'customer --workers=4' } }), /supported browser project group/);
  assert.throws(() => containerPlan({ ...options, source: { ...source, PLAYWRIGHT_PROJECT_GROUP: 'toString' } }), /supported browser project group/);
});

test('CI browser timeouts allow both device projects and reserve time for setup and diagnostics', () => {
  const browser = section('browser');
  const jobTimeout = Number(browser.match(/^    timeout-minutes: (\d+)$/m)?.[1]);
  const testTimeout = Number(browser.match(/run: node e2e\/ci-container\.cjs\n\s+timeout-minutes: (\d+)/)?.[1]);
  assert.ok(testTimeout >= 10, 'Sequential iPhone and desktop coverage needs at least ten minutes');
  assert.ok(jobTimeout >= testTimeout + 5, 'Reserve five additional minutes for setup and diagnostic uploads');
});

test('CI retains setup and test timings even on failure, outside Playwright output cleanup', () => {
  for (const name of ['unit', 'browser']) {
    const job = section(name);
    assert.match(job, /run: node scripts\/time-test-phase\.cjs npm-version/);
    assert.match(job, /run: node scripts\/time-test-phase\.cjs dependencies/);
    assert.match(job, /name: Summarize test performance\n\s+if: \$\{\{ always\(\) && !cancelled\(\) \}\}\n\s+run: node scripts\/report-test-timings\.cjs/);
    assert.match(job, /\.test-metrics\//);
    assert.match(job, /include-hidden-files: true/);
  }
  assert.match(section('browser'), /run: node scripts\/time-test-phase\.cjs browser-pull/);
  const { args } = containerPlan(options);
  assert.ok(args.some(arg => /^NITEWIDE_TEST_TIMING_RUN_ID=[a-f0-9]{32}$/.test(arg)));
  const config = require('../../../playwright.config.cjs');
  assert.ok(config.reporter.some(([name]) => name === './e2e/timing-reporter.cjs'));
});

test('CI bounds cascading failures without weakening retries, flaky detection or release gates', () => {
  const config = require('../../../playwright.config.cjs');
  assert.equal(config.maxFailures, process.env.CI ? 3 : 0);
  assert.equal(config.retries, process.env.CI ? 1 : 0);
  assert.equal(config.failOnFlakyTests, Boolean(process.env.CI));
  assert.equal(config.forbidOnly, Boolean(process.env.CI));
  assert.equal(config.workers, 1);
  assert.equal(config.timeout, 45000);
  assert.match(section('verify'), /test "\$BROWSER_RESULT" = success/);
});

test('all parallel verification jobs gate publication without registry writes or duplicate builds', () => {
  for (const name of ['unit', 'browser']) assert.match(section(name), /image: postgis\/postgis:18-3\.6/);
  for (const environment of ['staging', 'production']) {
    const blueprint = fs.readFileSync(path.join(root, `deploy/render.${environment}.yaml`), 'utf8');
    assert.match(blueprint, /postgresMajorVersion: "18"/);
  }
  const testDatabase = fs.readFileSync(path.join(root, 'deploy/compose.postgres18.yml'), 'utf8');
  assert.match(testDatabase, /image: postgis\/postgis:18-3\.6/);
  assert.match(testDatabase, /"127\.0\.0\.1:5434:5432"/);
  assert.match(testDatabase, /- \/var\/lib\/postgresql\n/);
  assert.doesNotMatch(testDatabase, /nitewide_postgres|\/var\/lib\/postgresql\/data/);
  assert.match(section('verify'), /needs: \[unit, browser, build\]/);
  assert.match(section('verify'), /if: \$\{\{ always\(\) \}\}/);
  for (const name of ['UNIT', 'BROWSER', 'BUILD']) assert.match(section('verify'), new RegExp(`test "\\$${name}_RESULT" = success`));
  assert.match(section('publish'), /needs: \[verify, build\]/);
  for (const name of ['unit', 'browser', 'build']) {
    const job = section(name);
    assert.doesNotMatch(job, /^    needs:/m);
    assert.match(job, /cancel-in-progress: true/);
    assert.match(job, /timeout-minutes:/);
    assert.doesNotMatch(job, /packages: write|docker\/login-action|RENDER_DEMO_DEPLOY_HOOK/);
  }
  assert.equal((workflow.match(/uses: docker\/build-push-action/g) || []).length, 1);
  assert.match(section('build'), /push: false/);
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(workflow, /build-args:\s*\|\s*RELEASE_REVISION=\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /Runtime release identity differs from verified image/);
  assert.match(dockerfile, /ARG RELEASE_REVISION/);
  assert.match(dockerfile, /\/app\/apps\/api\/release\.json/);
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/shared\/discovery-areas\.mjs apps\/shared\/discovery-areas\.mjs/);
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/shared\/report-dates\.mjs apps\/shared\/report-dates\.mjs/);
  assert.match(section('build'), /require\('\.\/apps\/api\/src\/http\/report-date-schemas\.js'\)/);
  assert.match(section('build'), /cache-from: type=gha,scope=nitewide-demo-amd64/);
  assert.match(section('build'), /compression-level: 0/);
  assert.match(section('build'), /retention-days: 1/);
  assert.match(section('publish'), /sha256sum --check nitewide-demo.tar.sha256/);
  assert.match(section('publish'), /docker load --input nitewide-demo.tar/);
  assert.doesNotMatch(section('publish'), /docker build|build-push-action/);
  assert.doesNotMatch(workflow, /test:email:.*simulated/);
});

test('publication and deployment do not cancel started releases or deploy stale commits', () => {
  for (const name of ['publish', 'deploy']) {
    assert.match(section(name), /cancel-in-progress: false/);
    assert.match(section(name), /current_sha.*git ls-remote/);
    assert.match(section(name), /\[ "\$current_sha" = "\$GITHUB_SHA" \]/);
    assert.match(section(name), /if: steps.current.outputs.current == 'true'/);
  }
  assert.match(section('deploy'), /needs: publish/);
  assert.match(section('deploy'), /if: github.ref == 'refs\/heads\/main' && needs.publish.outputs.digest != ''/);
  assert.match(workflow, /branches: \[main, staging, production\]/);
  assert.match(section('publish'), /refs\/heads\/staging.*refs\/heads\/production/);
  assert.match(section('publish'), /refs\/heads\/\$GITHUB_REF_NAME/);
  assert.match(section('publish'), /if \[ "\$GITHUB_REF_NAME" = main \]; then\s+docker tag nitewide-demo:test "\$IMAGE:demo"/);
  assert.match(section('deploy'), /--connect-timeout 10 --max-time 30/);
});

test('staging alias advances only after a successful serialized rollout without rebuilding the image', () => {
  const staging = section('deploy-staging');
  assert.match(staging, /timeout-minutes: 28/);
  assert.match(staging, /if: github.ref == 'refs\/heads\/staging' && needs.publish.outputs.digest != ''/);
  assert.match(staging, /group: nitewide-staging-deploy\n\s+cancel-in-progress: false/);
  assert.match(staging, /permissions:\n\s+contents: read\n\s+packages: write/);
  assert.match(section('publish'), /packages: write/);
  assert.equal((workflow.match(/packages: write/g) || []).length, 2);
  for (const name of ['unit', 'browser', 'build', 'verify', 'deploy']) assert.doesNotMatch(section(name), /packages: write/);
  const steps = staging.split(/^      - /m).slice(1);
  const rolloutIndex = steps.findIndex(step => /run: node deploy\/staging\.cjs/.test(step));
  assert.ok(rolloutIndex >= 0);
  assert.match(steps[rolloutIndex], /id: rollout/);
  const promotionSteps = steps.slice(rolloutIndex + 1);
  assert.equal(promotionSteps.length, 3);
  for (const step of promotionSteps) assert.match(step, /if: steps.current.outputs.current == 'true' && steps.rollout.outcome == 'success'/);
  assert.match(promotionSteps[0], /uses: docker\/login-action@dbcb813823bdd20940b903addbd779551569679f/);
  assert.match(promotionSteps[1], /uses: docker\/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069/);
  assert.match(promotionSteps[1], /driver: docker/);
  assert.doesNotMatch(promotionSteps[1], /^\s+(?:install|version):/m);
  assert.match(promotionSteps[2], /IMAGE: \$\{\{ needs.publish.outputs.image \}\}/);
  assert.match(promotionSteps[2], /DIGEST: \$\{\{ needs.publish.outputs.digest \}\}/);
  assert.match(promotionSteps[2], /STAGING_ROLLOUT_RESULT: \$\{\{ steps.rollout.outcome \}\}/);
  assert.match(promotionSteps[2], /run: node deploy\/promote-staging\.cjs/);
  assert.doesNotMatch(staging, /docker (?:pull|build)|build-push-action/);
  for (const name of ['publish', 'deploy']) assert.doesNotMatch(section(name), /promote-staging\.cjs|STAGING_ROLLOUT_RESULT|\$IMAGE:staging/);
});

test('retired admin browser paths are excluded while rebuild workflows have dedicated coverage', () => {
  const config = require('../../../playwright.config.cjs');
  assert.deepEqual(config.projects.map(project => project.name), ['customer-iphone', 'customer-desktop', 'business-iphone', 'business-desktop', 'admin-rebuild-iphone', 'admin-rebuild-desktop']);
  for (const project of config.projects.filter(project => project.name.startsWith('admin-'))) {
    assert.deepEqual(project.testMatch, ['admin-rebuild.spec.cjs', 'admin-access-requests.spec.cjs']);
    assert.ok(!project.testMatch.includes('admin.spec.cjs'));
  }
  for (const project of config.projects.filter(project => project.name.startsWith('business-'))) {
    assert.deepEqual(project.testMatch, ['business.spec.cjs', 'business-access.spec.cjs', 'business-payments.spec.cjs','commissions-messages.spec.cjs']);
  }
  assert.ok(!fs.existsSync(path.join(root, 'e2e/specs/admin.spec.cjs')));
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /npm run build --workspace @nitewide\/admin/);
});
