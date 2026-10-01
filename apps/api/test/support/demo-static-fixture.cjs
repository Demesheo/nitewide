const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Hosted-demo API tests need entry documents, not a prior frontend build.
// Keep these files outside the checkout so CI and local tests use the same inputs.
async function createDemoStaticFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nitewide-demo-static-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['customer', 'business', 'admin']) {
    const dist = path.join(root, 'apps', name, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'index.html'), `<html><body>${name} test fixture</body></html>`);
  }
  return root;
}

module.exports = { createDemoStaticFixture };
