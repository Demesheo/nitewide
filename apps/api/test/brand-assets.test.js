const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, copyFile, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { installDemoStatic } = require('../src/http/demo-static');
const { request } = require('./support/http-client.cjs');

const root = path.resolve(__dirname, '../../..');
const apps = ['customer', 'business', 'admin'];
const variants = [['logo', 192], ['favicon', 64], ['touch-icon', 180]];
const asset = (app, name) => path.join(root, 'apps', app, 'src/assets', `nitewide-${name}-v1.png`);

test('approved logo derivatives are small transparent PNGs and identical across apps', async () => {
  for (const [name, size] of variants) {
    const approved = await readFile(asset('customer', name));
    assert.equal(approved.readUInt32BE(16), size);
    assert.equal(approved.readUInt32BE(20), size);
    assert.equal(approved[25], 6, 'RGBA preserves the supplied transparent background');
    assert.ok(approved.length < 32000, `${name} must not ship the full-size source image`);
    for (const app of apps) assert.deepEqual(await readFile(asset(app, name)), approved);
  }
});

test('each app declares favicon and iOS home-screen icons using build-managed assets', async () => {
  for (const app of apps) {
    const html = await readFile(path.join(root, 'apps', app, 'index.html'), 'utf8');
    assert.match(html, /rel="icon" type="image\/png" sizes="64x64" href="\/src\/assets\/nitewide-favicon-v1.png"/);
    assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/src\/assets\/nitewide-touch-icon-v1.png"/);
    assert.doesNotMatch(html, /favicon\.svg|vite\.svg/);
  }
});

test('hosted customer, business and admin icon routes serve PNG bytes rather than SPA HTML', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nitewide-brand-routes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const app of apps) {
    const dist = path.join(directory, 'apps', app, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    const prefix = app === 'customer' ? '' : `/${app}`;
    const html = (await readFile(path.join(root, 'apps', app, 'index.html'), 'utf8'))
      .replaceAll('/src/assets/', `${prefix}/assets/`);
    await writeFile(path.join(dist, 'index.html'), html);
    for (const [name] of variants) await copyFile(asset(app, name), path.join(dist, 'assets', `nitewide-${name}-v1.png`));
  }
  const app = express();
  installDemoStatic(app, directory);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const [name, page] of [['customer', '/'], ['business', '/app'], ['admin', '/admin']]) {
    const html = (await request(server, page)).text;
    const links = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]+href="([^"]+)"/g)];
    assert.equal(links.length, 2);
    for (const [, url] of links) {
      const response = await request(server, url);
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'], /image\/png/);
      assert.deepEqual(response.body, await readFile(path.join(directory, 'apps', name, 'dist/assets', path.basename(url))));
    }
  }
});
