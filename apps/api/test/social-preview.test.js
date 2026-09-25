const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mkdtemp, mkdir, readFile, copyFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { installDemoStatic } = require('../src/http/demo-static');

const repo = path.resolve(__dirname, '../../..');
const imagePath = '/images/nitewide-social-nightlife-v1.png';
const imageUrl = 'https://nitewide-demo.onrender.com' + imagePath;

test('customer preview is present in initial HTML and serves the approved brand image without login', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nitewide-social-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['customer', 'business', 'admin']) {
    const dist = path.join(root, 'apps', name, 'dist');
    await mkdir(dist, { recursive: true });
    await copyFile(path.join(repo, 'apps', name, 'index.html'), path.join(dist, 'index.html'));
  }
  const images = path.join(root, 'apps/customer/dist/images');
  await mkdir(images, { recursive: true });
  const source = path.join(repo, 'apps/customer/public', imagePath);
  await copyFile(source, path.join(images, path.basename(imagePath)));
  const app = express();
  installDemoStatic(app, root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  for (const url of ['/', '/?event=61daf017-d30c-4030-9b89-dd29d875ddaf', '/?ref=test']) {
    const response = await fetch(origin + url, { headers: { 'user-agent': 'facebookexternalhit/1.1' } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('<meta property="og:image" content="' + imageUrl + '"'));
    assert.ok(html.includes('<meta name="twitter:image" content="' + imageUrl + '"'));
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /property="og:title" content="Nitewide — The night is yours\."/);
    assert.match(html, /property="og:image:alt"/);
    assert.equal((html.match(/property="og:image"/g) || []).length, 1);
  }
  for (const route of ['/business', '/app', '/sign-in', '/admin']) {
    const html = await (await fetch(origin + route)).text();
    assert.ok(!html.includes(imageUrl), route + ' must not acquire customer preview metadata');
  }
  const response = await fetch(origin + imagePath);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/png/);
  const image = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(image, await readFile(source));
  assert.equal(image.readUInt32BE(16), 1734);
  assert.equal(image.readUInt32BE(20), 907);
});
