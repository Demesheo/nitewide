const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const automatic = /test:email:[\w:]*simulated|check-resend-(?:business-)?workflows\.cjs/;

test('commit, build, and deploy paths never invoke quota-consuming email simulations', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const apiScripts = JSON.parse(read('apps/api/package.json')).scripts;
  for (const key of ['test', 'build', 'deploy:demo']) assert.doesNotMatch(scripts[key], automatic, `root ${key}`);
  for (const key of ['test', 'build']) if (apiScripts[key]) assert.doesNotMatch(apiScripts[key], automatic, `API ${key}`);
  for (const file of ['.github/workflows/demo-image.yml', 'Dockerfile', 'deploy/start.cjs', 'deploy/trigger-demo.cjs', 'scripts/run-default-tests.cjs']) {
    assert.doesNotMatch(read(file), automatic, file);
  }
  assert.match(read('.github/workflows/demo-image.yml'), /- run: npm test/);
  assert.match(apiScripts.test, /email-tests\/\*\.test\.js/);
  assert.match(read('scripts/run-default-tests.cjs'), /RESEND_API_KEY: ''/);
  assert.match(scripts['test:email:customer:simulated'], /check-resend-workflows\.cjs/);
  assert.match(scripts['test:email:business:simulated'], /check-resend-business-workflows\.cjs/);
});
