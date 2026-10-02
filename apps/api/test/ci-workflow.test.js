const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { containerPlan } = require('../../../e2e/ci-container.cjs');
const root = path.resolve(__dirname, '../../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/demo-image.yml'), 'utf8');
const section = name => {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:|$(?![\\s\\S]))`, 'm'));
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

test('CI separates all six browser projects into isolated per-app jobs without increasing database concurrency', () => {
  const groups = ['customer', 'business', 'admin-rebuild'];
  assert.match(section('browser'), /app: \[customer, business, admin-rebuild\]/);
  assert.match(section('browser'), /fail-fast: false/);
  assert.match(section('browser'), /group: demo-browser-\$\{\{ matrix\.app \}\}-\$\{\{ github\.ref \}\}/);
  assert.match(section('browser'), /PLAYWRIGHT_PROJECT_GROUP: \$\{\{ matrix\.app \}\}/);
  assert.match(section('browser'), /name: playwright-results-\$\{\{ matrix\.app \}\}/);
  assert.match(section('browser'), /services:\s+postgres:/);
  const coveredProjects = [];
  for (const group of groups) {
    const { args } = containerPlan({ ...options, source: { ...source, PLAYWRIGHT_PROJECT_GROUP: group } });
    assert.deepEqual(args.slice(-6), ['npm', 'run', 'test:e2e', '--', `--project=${group}-iphone`, `--project=${group}-desktop`]);
    assert.doesNotMatch(args.join(' '), /never-forward|live\.example|--workers|--fully-parallel/);
    coveredProjects.push(...args.filter(argument => argument.startsWith('--project=')).map(argument => argument.slice('--project='.length)));
  }
  assert.deepEqual(coveredProjects, require('../../../playwright.config.cjs').projects.map(project => project.name));
  assert.throws(() => containerPlan({ ...options, source: { ...source, PLAYWRIGHT_PROJECT_GROUP: 'customer --workers=4' } }), /supported browser project group/);
});

test('CI browser timeouts allow both device projects and reserve time for setup and diagnostics', () => {
  const browser = section('browser');
  const jobTimeout = Number(browser.match(/^    timeout-minutes: (\d+)$/m)?.[1]);
  const testTimeout = Number(browser.match(/run: node e2e\/ci-container\.cjs\n\s+timeout-minutes: (\d+)/)?.[1]);
  assert.ok(testTimeout >= 10, 'Sequential iPhone and desktop coverage needs at least ten minutes');
  assert.ok(jobTimeout >= testTimeout + 5, 'Reserve five additional minutes for setup and diagnostic uploads');
});

test('all parallel verification jobs gate publication without registry writes or duplicate builds', () => {
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
  assert.match(section('deploy'), /if: needs.publish.outputs.digest != ''/);
  assert.match(section('deploy'), /--connect-timeout 10 --max-time 30/);
});

test('legacy admin browser projects remain paused while rebuild workflows have dedicated coverage', () => {
  const config = require('../../../playwright.config.cjs');
  assert.deepEqual(config.projects.map(project => project.name), ['customer-iphone', 'customer-desktop', 'business-iphone', 'business-desktop', 'admin-rebuild-iphone', 'admin-rebuild-desktop']);
  for (const project of config.projects.filter(project => project.name.startsWith('admin-'))) {
    assert.deepEqual(project.testMatch, ['admin-rebuild.spec.cjs', 'admin-access-requests.spec.cjs']);
    assert.ok(!project.testMatch.includes('admin.spec.cjs'));
  }
  for (const project of config.projects.filter(project => project.name.startsWith('business-'))) {
    assert.deepEqual(project.testMatch, ['business.spec.cjs', 'business-access.spec.cjs', 'business-payments.spec.cjs']);
  }
  assert.ok(fs.existsSync(path.join(root, 'e2e/specs/admin.spec.cjs')));
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /npm run build --workspace @nitewide\/admin/);
});
