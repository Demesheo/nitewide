import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createTestServer } from './helpers/vite-server.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const missing = async path => assert.rejects(access(path), { code: 'ENOENT' });

test('each test server has a unique cache and repeated close awaits its removal', async () => {
  const options = [];
  let closes = 0;
  const factory = async config => { options.push(config); return { config, async close() { closes++; } }; };
  const first = await createTestServer({ root, cacheDir: resolve(root, 'node_modules/.vite'), server: { middlewareMode: true } }, factory);
  const second = await createTestServer({ root }, factory);
  try {
    assert.notEqual(options[0].cacheDir, options[1].cacheDir);
    for (const config of options) {
      assert.ok(relative(root, config.cacheDir).startsWith('..'), 'test caches are outside the checkout');
      await access(config.cacheDir);
    }
    assert.equal(options[0].server.middlewareMode, true, 'other Vite options are preserved');
    const close = first.close();
    assert.equal(first.close(), close, 'repeated close shares the cleanup promise');
    await close;
    await missing(options[0].cacheDir);
    assert.equal(closes, 1);
  } finally { await Promise.all([first.close(), second.close()]); }
  await missing(options[1].cacheDir);
});

test('failed startup and failed close both clean up only their temporary cache', async () => {
  let failedCache;
  const failure = new Error('Synthetic Vite startup failure');
  await assert.rejects(createTestServer({}, async config => { failedCache = config.cacheDir; throw failure; }), error => error === failure);
  await missing(failedCache);
  let closeCache;
  const closeFailure = new Error('Synthetic Vite close failure');
  const server = await createTestServer({}, async config => {
    closeCache = config.cacheDir;
    return { close: async () => { throw closeFailure; } };
  });
  await assert.rejects(server.close(), error => error === closeFailure);
  await missing(closeCache);
});

test('real Vite servers for all three apps resolve isolated caches and strict ports', async () => {
  for (const app of ['customer', 'business', 'admin']) {
    const appRoot = resolve(root, 'apps', app);
    const vite = await createTestServer({ root: appRoot, configFile: resolve(appRoot, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const cacheDir = vite.config.cacheDir;
    try {
      assert.ok(relative(root, cacheDir).startsWith('..'));
      assert.equal(vite.config.server.strictPort, true);
      await vite.ssrLoadModule('/src/lib/utils.js');
    } finally { await vite.close(); }
    await missing(cacheDir);
  }
});

test('UI tests cannot bypass the isolated Vite helper', async () => {
  // Scan all three apps so adding a new interaction test cannot silently
  // reintroduce cache sharing. The helper is the only direct Vite importer.
  const violations = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && path !== fileURLToPath(new URL('./helpers/vite-server.js', import.meta.url))) {
        const source = await readFile(path, 'utf8');
        if (/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]vite['"]/.test(source)) violations.push(relative(root, path));
      }
    }
  }
  for (const app of ['customer', 'business', 'admin']) await scan(resolve(root, 'apps', app, 'test'));
  assert.deepEqual(violations, [], 'start test Vite servers with helpers/vite-server.js');
});

test('an occupied port fails rather than starting a second dev app on another port', async () => {
  const blocker = createHttpServer((_req, res) => res.end('occupied'));
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(0, '127.0.0.1', resolve); });
  let vite;
  try {
    const appRoot = resolve(root, 'apps/customer');
    vite = await createTestServer({ root: appRoot, configFile: resolve(appRoot, 'vite.config.js'), logLevel: 'silent', server: { host: '127.0.0.1', port: blocker.address().port }, appType: 'custom' });
    await assert.rejects(vite.listen(), /Port \d+ is already in use/);
  } finally {
    await vite?.close();
    await new Promise((resolve, reject) => blocker.close(error => error ? reject(error) : resolve()));
  }
});

test('fresh development commands rebuild dependencies without weakening fixed ports', async () => {
  const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.match(rootPackage.scripts['dev:fresh'], /concurrently/);
  for (const command of ['dev', 'dev:fresh']) assert.match(rootPackage.scripts[command], /--kill-others-on-fail\b/);
  for (const [app, port] of [['customer', 5173], ['business', 5174], ['admin', 5175]]) {
    const { scripts } = JSON.parse(await readFile(resolve(root, 'apps', app, 'package.json'), 'utf8'));
    assert.match(scripts.dev, new RegExp(`--port ${port}\\b`));
    assert.match(scripts.dev, /--strictPort\b/);
    assert.doesNotMatch(scripts.dev, /--force\b/);
    assert.match(scripts['dev:fresh'], /--force\b/);
    assert.match(scripts['dev:fresh'], /--strictPort\b/);
    assert.ok(rootPackage.scripts['dev:fresh'].includes(`dev:fresh --workspace @nitewide/${app}`));
  }
});
