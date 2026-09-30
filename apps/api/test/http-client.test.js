const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const multer = require('multer');
const { request } = require('./support/http-client.cjs');

async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

test('Supertest supports fluent HTTP assertions, bearer authentication and numeric JSON fields', async (t) => {
  const app = express();
  app.use(express.json());
  app.post('/guestlist', (req, res) => res.status(201).json({
    partySize: req.body.partySize, authorization: req.headers.authorization,
    scenario: req.headers['x-test-scenario'], query: req.query.pool,
  }));
  const server = await serve(t, app);
  await request(server, '/guestlist?pool=personal', {
    method: 'POST', token: 'test-session', headers: { 'x-test-scenario': 'invite' }, body: { partySize: 10 },
  }).expect(201).expect('Content-Type', /json/).expect({
    partySize: 10, authorization: 'Bearer test-session', scenario: 'invite', query: 'personal',
  });
});

test('Supertest preserves API error status and body without hiding failures', async (t) => {
  const app = express();
  app.get('/error/:status', (req, res) => res.status(Number(req.params.status)).json({ error: { code: 'EXPECTED_ERROR' } }));
  const server = await serve(t, app);
  for (const status of [401, 403, 409, 422, 429, 500]) {
    const response = await request(server, `/error/${status}`).expect(status);
    assert.equal(response.body.error.code, 'EXPECTED_ERROR');
  }
  await assert.rejects(request(server, '/error/409').expect(200), /expected 200/);
});

test('Supertest sends raw webhook bytes unchanged and uploads multipart files', async (t) => {
  const app = express();
  app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => res.json({ raw: req.body.toString() }));
  app.post('/upload', multer({ storage: multer.memoryStorage() }).single('image'), (req, res) => res.json({
    name: req.file.originalname, content: req.file.buffer.toString(), caption: req.body.caption,
  }));
  const server = await serve(t, app);
  const raw = '{ "partySize": 10, "type": "delivered" }';
  await request(server, '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })
    .expect(200).expect({ raw });
  await request(server, '/upload', { method: 'POST' })
    .field('caption', 'flyer').attach('image', Buffer.from('test-image'), 'flyer.png')
    .expect(200).expect({ name: 'flyer.png', content: 'test-image', caption: 'flyer' });
});

test('Supertest handles CSV and does not follow redirects to external destinations', async (t) => {
  const app = express();
  app.get('/export', (_req, res) => res.type('text/csv').set('Content-Disposition', 'attachment; filename="report.csv"').send('name,spots\nSam,10\n'));
  app.get('/redirect', (_req, res) => res.redirect('https://example.invalid/private'));
  const server = await serve(t, app);
  const csv = await request(server, '/export').expect(200).expect('Content-Type', /text\/csv/);
  assert.equal(csv.text, 'name,spots\nSam,10\n');
  assert.match(csv.headers['content-disposition'], /report.csv/);
  await request(server, '/redirect').expect(302).expect('Location', 'https://example.invalid/private');
});

test('HTTP test helper rejects remote URLs, non-loopback servers and unsupported requests', () => {
  assert.throws(() => request('https://nitewide-demo.onrender.com', '/api/events'), /never a URL/);
  assert.throws(() => request({}, '/api/events'), /never a URL/);
  const app = express();
  for (const pathname of ['https://example.invalid', '//example.invalid', 'api/events']) {
    assert.throws(() => request(app, pathname), /application-relative/);
  }
  assert.throws(() => request(app, '/', { method: 'CONNECT' }), /Unsupported/);
  assert.throws(() => request({ listen() {}, address: () => ({ address: '0.0.0.0' }) }, '/'), /loopback/);
});
