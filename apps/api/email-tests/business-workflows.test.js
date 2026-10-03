const test = require('node:test');
const assert = require('node:assert/strict');
const { collectBusinessWorkflowMessages, BUSINESS_TEMPLATES } = require('./business-workflow-actions.cjs');
const { TEMPLATES } = require('../src/services/email-templates');
const { queueGuestlistReviewNeeded, queueTeamInvitation, queuePromoterInvitation } = require('../src/services/business-email-events');
const { validateBusinessMessages } = require('../../../scripts/check-resend-business-workflows.cjs');

test('fourteen business actions queue the eight intended templates without provider requests', async () => {
  const messages = await collectBusinessWorkflowMessages('a1b2c3d4');
  assert.equal(messages.length, 14);
  assert.deepEqual(new Set(messages.map((item) => item.template)), BUSINESS_TEMPLATES);
  assert.equal(new Set(messages.map((item) => item.key)).size, messages.length);
  assert.ok(messages.every(({ to }) => /^delivered\+business-[a-z0-9-]+-a1b2c3d4@resend\.dev$/.test(to)));
  assert.deepEqual(messages.map((item) => item.template), [
    TEMPLATES.teamInvitation, TEMPLATES.promoterInvitation,
    TEMPLATES.accessAccepted, TEMPLATES.accessAccepted,
    TEMPLATES.accessChanged, TEMPLATES.accessChanged,
    TEMPLATES.eventTermsChanged, TEMPLATES.eventTermsChanged,
    TEMPLATES.guestlistReviewNeeded,
    TEMPLATES.businessEventStatus, TEMPLATES.businessEventStatus,
    TEMPLATES.businessEventStatus, TEMPLATES.businessEventStatus,
    TEMPLATES.instructionsSent,
  ]);
  for (const invite of messages.slice(0, 2)) {
    const url = new URL(invite.variables.ACCEPT_URL);
    assert.equal(url.hostname, 'business.nitewide.example');
    assert.equal(url.pathname, '/app');
    assert.ok(url.searchParams.get('invite'));
    assert.equal(invite.to.includes('manager'), false);
    assert.match(invite.variables.EXPIRES_AT, / UTC$/);
  }
  assert.doesNotThrow(() => validateBusinessMessages(messages, 'a1b2c3d4'));
  assert.throws(() => validateBusinessMessages([{ ...messages[0], to: 'someone@example.com' }, ...messages.slice(1)], 'a1b2c3d4'));
  assert.equal(messages[6].variables.OLD_VALUE, '5%');
  assert.equal(messages[6].variables.NEW_VALUE, '0%');
  assert.equal(messages[7].variables.OLD_VALUE, '5');
  assert.equal(messages[7].variables.NEW_VALUE, '8');
  assert.equal(messages[13].variables.DELIVERY_STATUS, 'Queued for delivery');
  assert.equal(messages[13].variables.RECIPIENT_COUNT, '1');
  assert.ok(messages.every(({ variables }) => !Object.keys(variables).some((key) => /FEE|PROCESSING|PROVIDER_REVENUE/.test(key))));
});

test('emailed invitations target Business on shared-domain and standalone deployments', async () => {
  for (const businessAppUrl of ['https://nitewide-demo.onrender.com/app', 'https://business.example.test/', 'http://localhost:5174/app']) {
    const messages = [];
    const email = { enabled: true, queue: async message => messages.push(message) };
    const invitation = { id: 'synthetic-invite', tokenHash: 'synthetic-hash', email: 'test+invite@nitewide.test', role: 'employee', commissionBps: 0, expiresAt: '2027-01-01T00:00:00Z' };
    const token = 'synthetic +/?&=# invitation';
    const transaction = { id: 'synthetic-transaction' };
    await queueTeamInvitation({ email, invitation, organization: { name: 'Test team' }, token, businessAppUrl, transaction });
    await queuePromoterInvitation({ email, invitation, event: { title: 'Test night' }, token, businessAppUrl, transaction });
    assert.equal(messages.length, 2);
    for (const message of messages) {
      const url = new URL(message.variables.ACCEPT_URL);
      assert.equal(url.origin, new URL(businessAppUrl).origin);
      assert.equal(url.pathname, '/app');
      assert.equal(url.searchParams.get('invite'), token);
      assert.deepEqual([...url.searchParams.keys()], ['invite']);
      assert.equal(url.hash, '');
    }
  }
});

test('guestlist reviewer email requires an enabled email service and nonempty authorized reviewer IDs', async () => {
  let reads = 0;
  const models = { User: { findAll: async () => { reads++; return []; } } };
  const base = { models, reviewerIds: [], entry: { id: 'entry', partySize: 2 }, event: { id: 'event' }, businessAppUrl: 'https://example.com/app' };
  assert.equal(await queueGuestlistReviewNeeded({ ...base, email: { enabled: true } }), 0);
  assert.equal(await queueGuestlistReviewNeeded({ ...base, reviewerIds: ['reviewer'], email: { enabled: false } }), 0);
  assert.equal(reads, 0);
});
