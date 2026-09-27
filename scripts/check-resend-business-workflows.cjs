#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const dotenv = require('dotenv');
const { sendTemplate } = require('../apps/api/src/services/email-service');
const { TEMPLATES } = require('../apps/api/src/services/email-templates');
const { collectBusinessWorkflowMessages } = require('../apps/api/email-tests/business-workflow-actions.cjs');
const { validateSettings, preflight, verifyDelivered } = require('./check-resend-workflows.cjs');

const root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const EXPECTED = [
  TEMPLATES.teamInvitation, TEMPLATES.promoterInvitation,
  TEMPLATES.accessAccepted, TEMPLATES.accessAccepted,
  TEMPLATES.accessChanged, TEMPLATES.accessChanged,
  TEMPLATES.eventTermsChanged, TEMPLATES.eventTermsChanged,
  TEMPLATES.guestlistReviewNeeded,
  TEMPLATES.businessEventStatus, TEMPLATES.businessEventStatus,
  TEMPLATES.businessEventStatus, TEMPLATES.businessEventStatus,
  TEMPLATES.instructionsSent,
];

function validateBusinessMessages(messages, run) {
  assert.deepEqual(messages.map((message) => message.template), EXPECTED, 'All fourteen action-triggered business messages must be queued in order.');
  assert.equal(new Set(messages.map((message) => message.key)).size, messages.length, 'Each send needs a unique idempotency key.');
  for (const message of messages) {
    assert.match(message.to, new RegExp(`^delivered\\+business-[a-z0-9-]*-${run}@resend\\.dev$`));
    assert.ok(message.action && message.variables && typeof message.variables === 'object');
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('Run npm run test:email:business:simulated without extra arguments. This command consumes up to fourteen email sends.');
  const mock = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:email:business:mocked'], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', RESEND_API_KEY: '', RESEND_TEST_READ_API_KEY: '', RESEND_FROM_EMAIL: '' },
  });
  if (mock.error) throw mock.error;
  if (mock.status !== 0) throw new Error('Mocked email tests failed; no simulator emails were sent.');
  dotenv.config({ path: path.join(root, '.env') });
  validateSettings(process.env);
  const readKey = process.env.RESEND_TEST_READ_API_KEY || process.env.RESEND_API_KEY;
  const run = randomUUID().slice(0, 8);
  const messages = await collectBusinessWorkflowMessages(run);
  validateBusinessMessages(messages, run);
  await preflight(messages, readKey);

  const sends = [];
  for (const message of messages) {
    try {
      const id = await sendTemplate({ apiKey: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL,
        to: message.to, templateAlias: message.template, variables: message.variables, dedupeKey: message.key });
      sends.push({ ...message, id });
      process.stdout.write(`Accepted: ${message.action} (${id})\n`);
      await pause(150);
    } catch (error) {
      throw new Error(`Stopped after ${sends.length} accepted send(s); ${message.action} failed (${error.code || error.status || error.message}). Inspect IDs before rerunning.`);
    }
  }
  await verifyDelivered(sends, readKey);
  process.stdout.write('All fourteen business action emails reached delivered. Fourteen simulator emails counted toward quota.\n');
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { validateBusinessMessages, EXPECTED };
