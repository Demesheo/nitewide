const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmailService, sendTemplate, encryptVariables, decryptVariables } = require('../src/services/email-service');
const { TEMPLATES } = require('../src/services/email-templates');

test('Resend send uses a published template alias and stable idempotency key without exposing content in the URL', async () => {
  let request;
  const id = await sendTemplate({
    apiKey: 're_test_key', from: 'Nitewide <tickets@example.org>', to: 'guest@example.org',
    templateAlias: TEMPLATES.purchaseReceipt, variables: { NAME: 'Guest', BOOKING_URL: 'https://nitewide.example/booking' },
    dedupeKey: 'purchase/order-1',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: 'provider-message-1' }) };
    },
  });
  assert.equal(id, 'provider-message-1');
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers['Idempotency-Key'], 'purchase/order-1');
  assert.deepEqual(JSON.parse(request.options.body).template, {
    id: 'nitewide-purchase-receipt',
    variables: { NAME: 'Guest', BOOKING_URL: 'https://nitewide.example/booking' },
  });
  assert.equal(request.url.includes('re_test_key'), false);
});

test('outbox payloads are encrypted and use the configured secret', () => {
  const payload = { RESET_URL: 'https://nitewide.example/?resetPassword=secret' };
  const encrypted = encryptVariables(payload, 'a-secret-long-enough-to-encrypt-records');
  assert.equal(encrypted.includes('resetPassword'), false);
  assert.deepEqual(decryptVariables(encrypted, 'a-secret-long-enough-to-encrypt-records'), payload);
  assert.throws(() => decryptVariables(encrypted, 'wrong-secret'));
});

test('queue deduplicates a purchase and suppresses reserved demo addresses before any provider request', async () => {
  const rows = new Map();
  const outbox = { findOrCreate: async ({ where, defaults }) => {
    if (!rows.has(where.dedupeKey)) rows.set(where.dedupeKey, { id: String(rows.size + 1), ...defaults });
    return [rows.get(where.dedupeKey), true];
  } };
  const email = createEmailService({
    sequelize: {}, models: { EmailOutbox: outbox }, apiKey: 're_test_key',
    from: 'Nitewide <tickets@example.org>', encryptionKey: 'a-secret-long-enough-to-encrypt-records',
  });
  const message = { key: 'purchase/order-1', to: 'guest@example.org', template: TEMPLATES.purchaseReceipt, variables: { NAME: 'Guest' } };
  assert.equal(await email.queue(message), '1');
  assert.equal(await email.queue(message), '1');
  assert.equal(await email.queue({ ...message, key: 'purchase/order-2', to: 'seed.user@nitewide.test' }), null);
  assert.equal(rows.size, 1);
  assert.equal(rows.get('purchase/order-1').encryptedVariables.includes('Guest'), false);
});

test('transient delivery errors remain retryable while invalid requests do not', async () => {
  const clock = new Date('2026-09-26T12:00:00Z');
  const rows = [
    { dedupeKey: 'one', recipientEmail: 'one@example.org', templateAlias: TEMPLATES.welcome,
      encryptedVariables: encryptVariables({ NAME: 'One' }, 'same-secret'), status: 'pending', attemptCount: 0,
      async update(values) { Object.assign(this, values); } },
    { dedupeKey: 'two', recipientEmail: 'two@example.org', templateAlias: TEMPLATES.welcome,
      encryptedVariables: encryptVariables({ NAME: 'Two' }, 'same-secret'), status: 'pending', attemptCount: 0,
      async update(values) { Object.assign(this, values); } },
  ];
  const email = createEmailService({
    sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }) },
    models: { EmailOutbox: {
      update: async () => {},
      findAll: async () => rows,
    } },
    apiKey: 're_test_key', from: 'Nitewide <tickets@example.org>', encryptionKey: 'same-secret',
    now: () => clock,
    fetchImpl: async (_url, options) => {
      const recipient = JSON.parse(options.body).to[0];
      return { ok: false, status: recipient.startsWith('one') ? 503 : 422,
        json: async () => ({ name: 'send_error' }) };
    },
  });
  assert.equal(await email.drain(), 2);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].attemptCount, 1);
  assert.ok(rows[0].nextAttemptAt > clock);
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows[1].attemptCount, 1);
});
