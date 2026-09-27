const test = require('node:test');
const assert = require('node:assert/strict');
const { collectWorkflowMessages } = require('./workflow-actions.cjs');
const { TEMPLATES } = require('../src/services/email-templates');
const { EXPECTED_TEMPLATES, GUESTLIST_REQUEST_FLAG, REMAINING_FLAG, REMAINING_TEMPLATES,
  validateSettings, validateWorkflowMessages,
  selectMessages, preflight, verifyDelivered } = require('../../../scripts/check-resend-workflows.cjs');

test('eleven customer workflow actions queue their templates except waitlisted, all to delivered simulator labels', async () => {
  const messages = await collectWorkflowMessages('a1b2c3d4');
  assert.doesNotThrow(() => validateWorkflowMessages(messages, 'a1b2c3d4'));
  assert.deepEqual(messages.map(({ template }) => template), [
    TEMPLATES.verifyEmail, TEMPLATES.welcome, TEMPLATES.passwordReset, TEMPLATES.purchaseReceipt,
    TEMPLATES.guestlistReceived, TEMPLATES.guestlistDeclined, TEMPLATES.guestlistApproved,
    TEMPLATES.eventCancelled, TEMPLATES.eventTimeChange, TEMPLATES.eventVenueChange, TEMPLATES.eventInstructions,
  ]);
  assert.equal(EXPECTED_TEMPLATES.length, 11);
  assert.equal(messages.every(({ to }) => to.startsWith('delivered+')), true);
  assert.equal(messages.some(({ template }) => template === TEMPLATES.guestlistWaitlisted), false);
  assert.deepEqual(messages.filter(({ template }) => [TEMPLATES.guestlistReceived, TEMPLATES.guestlistDeclined,
    TEMPLATES.guestlistApproved].includes(template)).map(({ variables }) => variables.SPOTS), ['2', '2', '2']);
  assert.equal(selectMessages(messages, [GUESTLIST_REQUEST_FLAG]).length, 1);
  assert.equal(selectMessages(messages, [GUESTLIST_REQUEST_FLAG])[0].template, TEMPLATES.guestlistReceived);
  assert.deepEqual(selectMessages(messages, [REMAINING_FLAG]).map(({ template }) => template), REMAINING_TEMPLATES);
  assert.equal(selectMessages(messages, [REMAINING_FLAG]).length, 6);
  assert.throws(() => selectMessages(messages, ['--only=all']));
  assert.throws(() => validateWorkflowMessages([{ ...messages[0], to: 'customer@example.com' }, ...messages.slice(1)], 'a1b2c3d4'));
  assert.throws(() => validateWorkflowMessages(messages.map((item) => item.template === TEMPLATES.guestlistReceived
    ? { ...item, variables: { ...item.variables, SPOTS: 2 } } : item), 'a1b2c3d4'), /string template variables/);
});

test('delivery check rejects production, missing keys, and a non-simulator sender', () => {
  const valid = {
    NODE_ENV: 'development', RESEND_TEST_MODE: 'true', RESEND_API_KEY: 'send-key',
    RESEND_FROM_EMAIL: 'Nitewide <onboarding@resend.dev>',
  };
  assert.doesNotThrow(() => validateSettings(valid));
  for (const invalid of [
    { NODE_ENV: 'production' }, { CI: 'true' }, { HOSTED_DEMO: 'true' }, { RESEND_TEST_MODE: 'false' },
    { RESEND_API_KEY: '' },
    { RESEND_FROM_EMAIL: 'Nitewide <tickets@example.org>' },
  ]) {
    assert.throws(() => validateSettings({ ...valid, ...invalid }));
  }
});

test('template/read-access preflight rejects unpublished templates before any send', async () => {
  const messages = [{ template: TEMPLATES.welcome, variables: { NAME: 'Test' } }];
  const fetchImpl = async (url) => ({ ok: true, json: async () => url.includes('/templates/')
    ? { status: 'draft', variables: [] } : { data: [] } });
  await assert.rejects(() => preflight(messages, 'read-key', { fetchImpl, wait: async () => {} }), /not published/);
  const published = async (url) => ({ ok: true, json: async () => url.includes('/templates/')
    ? { status: 'published', variables: [{ key: 'SPOTS', type: 'string' }] } : { data: [] } });
  await assert.rejects(() => preflight([{ template: TEMPLATES.guestlistReceived, variables: { SPOTS: 2 } }], 'read-key',
    { fetchImpl: published, wait: async () => {} }), /non-string variables: SPOTS/);
});

test('delivery check verifies each exact message and delivered event without network access', async () => {
  const item = { id: 'message-1', to: 'delivered+account-a1b2c3d4@resend.dev', action: 'account signup' };
  let reads = 0;
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ id: item.id, to: [item.to], last_event: ++reads === 1 ? 'sent' : 'delivered' }),
  });
  await verifyDelivered([item], 'read-key', { fetchImpl, timeoutMs: 1000, wait: async () => {}, report: () => {} });
  assert.equal(reads, 2);
  await assert.rejects(() => verifyDelivered([item], 'read-key', {
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'other-id', to: [item.to], last_event: 'delivered' }) }),
    timeoutMs: 1000, wait: async () => {}, report: () => {},
  }), /different message or recipient/);
});
