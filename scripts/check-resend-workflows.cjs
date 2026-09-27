#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const dotenv = require('dotenv');
const { sendTemplate } = require('../apps/api/src/services/email-service');
const { TEMPLATES } = require('../apps/api/src/services/email-templates');
const { collectWorkflowMessages } = require('../apps/api/email-tests/workflow-actions.cjs');

const root = path.resolve(__dirname, '..');
const RESEND_API = 'https://api.resend.com';
const GUESTLIST_REQUEST_FLAG = '--only=guestlist-request';
const REMAINING_FLAG = '--only=remaining';
const REMAINING_TEMPLATES = Object.freeze([
  TEMPLATES.guestlistDeclined, TEMPLATES.guestlistApproved, TEMPLATES.eventCancelled,
  TEMPLATES.eventTimeChange, TEMPLATES.eventVenueChange, TEMPLATES.eventInstructions,
]);
const EXPECTED_TEMPLATES = Object.freeze([
  TEMPLATES.verifyEmail, TEMPLATES.welcome, TEMPLATES.passwordReset, TEMPLATES.purchaseReceipt,
  TEMPLATES.guestlistReceived, TEMPLATES.guestlistApproved, TEMPLATES.guestlistDeclined,
  TEMPLATES.eventCancelled, TEMPLATES.eventTimeChange, TEMPLATES.eventVenueChange, TEMPLATES.eventInstructions,
]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validateSettings(env) {
  if (env.CI || env.HOSTED_DEMO === 'true') throw new Error('Live email workflow checks are local-only; CI and the hosted demo are blocked.');
  if (env.NODE_ENV && env.NODE_ENV !== 'development') throw new Error('Set NODE_ENV=development for the local workflow check.');
  if (env.RESEND_TEST_MODE !== 'true' || !env.RESEND_API_KEY) throw new Error('Set RESEND_TEST_MODE=true and RESEND_API_KEY in the local .env.');
  const sender = env.RESEND_FROM_EMAIL?.match(/<([^>]+)>\s*$/)?.[1] || env.RESEND_FROM_EMAIL;
  if (sender?.trim().toLowerCase() !== 'onboarding@resend.dev') throw new Error('The workflow check requires onboarding@resend.dev as sender.');
}

function validateWorkflowMessages(messages, runLabel) {
  assert.equal(messages.length, EXPECTED_TEMPLATES.length, 'All eleven workflows must queue exactly one email before sending.');
  assert.deepEqual(new Set(messages.map((item) => item.template)), new Set(EXPECTED_TEMPLATES), 'Every implemented template except waitlisted must be covered exactly once.');
  assert.equal(new Set(messages.map((item) => item.key)).size, messages.length, 'Each message needs a unique idempotency key.');
  for (const message of messages) {
    assert.match(message.to, new RegExp(`^delivered\\+[a-z0-9-]*${runLabel}[a-z0-9-]*@resend\\.dev$`), `${message.action} must target this run's delivered simulator label.`);
    assert.ok(message.action && message.variables && typeof message.variables === 'object', 'Each message needs an action and template variables.');
    assert.ok(Object.values(message.variables).every((value) => typeof value === 'string'), `${message.action} must supply string template variables.`);
  }
}

function selectMessages(messages, args = []) {
  if (!args.length) return messages;
  if (args.length !== 1 || ![GUESTLIST_REQUEST_FLAG, REMAINING_FLAG].includes(args[0])) {
    throw new Error(`Use npm run test:email:customer:simulated with no options, -- ${GUESTLIST_REQUEST_FLAG} for one send, or -- ${REMAINING_FLAG} for six sends.`);
  }
  const selected = args[0] === GUESTLIST_REQUEST_FLAG
    ? messages.filter((message) => message.action === 'guestlist request' && message.template === TEMPLATES.guestlistReceived)
    : messages.filter((message) => REMAINING_TEMPLATES.includes(message.template));
  if (args[0] === GUESTLIST_REQUEST_FLAG) assert.equal(selected.length, 1, 'Focused guestlist request must select exactly one message.');
  else assert.deepEqual(selected.map((message) => message.template), REMAINING_TEMPLATES, 'Remaining customer run must select only the six unsent templates.');
  return selected;
}

async function requestJson(url, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Resend read API returned HTTP ${response.status}; no new email should be sent until permissions and templates are fixed.`);
  return response.json();
}

async function preflight(messages, apiKey, { fetchImpl = fetch, wait = pause } = {}) {
  await requestJson(`${RESEND_API}/emails?limit=1`, apiKey, fetchImpl);
  for (const message of messages) {
    const template = await requestJson(`${RESEND_API}/templates/${encodeURIComponent(message.template)}`, apiKey, fetchImpl);
    if (template.status !== 'published') throw new Error(`${message.template} is not published; no emails were sent.`);
    const missing = (template.variables || []).filter((variable) => !(variable.key in message.variables) && variable.fallback_value == null);
    if (missing.length) throw new Error(`${message.template} is missing required variables: ${missing.map((item) => item.key).join(', ')}; no emails were sent.`);
    const invalid = Object.entries(message.variables).filter(([, value]) => typeof value !== 'string');
    if (invalid.length) throw new Error(`${message.template} has non-string variables: ${invalid.map(([key]) => key).join(', ')}; no emails were sent.`);
    await wait(150);
  }
}

async function verifyDelivered(sends, apiKey, { fetchImpl = fetch, wait = pause, timeoutMs = 90000,
  report = (line) => process.stdout.write(line) } = {}) {
  const pending = new Map(sends.map((item) => [item.id, item]));
  const deadline = Date.now() + timeoutMs;
  while (pending.size && Date.now() <= deadline) {
    for (const item of [...pending.values()]) {
      const result = await requestJson(`${RESEND_API}/emails/${encodeURIComponent(item.id)}`, apiKey, fetchImpl);
      if (result.id !== item.id || !Array.isArray(result.to) || result.to.length !== 1 || result.to[0].toLowerCase() !== item.to) {
        throw new Error(`${item.action}: Resend returned a different message or recipient for ${item.id}.`);
      }
      if (result.last_event === 'delivered') {
        pending.delete(item.id);
        report(`Delivered: ${item.action} (${item.id})\n`);
      } else if (['bounced', 'complained', 'suppressed', 'failed'].includes(result.last_event)) {
        throw new Error(`${item.action}: expected delivered, got ${result.last_event} for ${item.id}.`);
      }
      await wait(150);
    }
    if (pending.size && Date.now() <= deadline) await wait(2000);
  }
  if (pending.size) throw new Error(`Delivery was not confirmed for ${[...pending.values()].map((item) => `${item.action} (${item.id})`).join(', ')}. Inspect Resend before rerunning; all accepted sends already count toward quota.`);
}

async function main() {
  if (process.argv.length > 3 || (process.argv.length === 3 && ![GUESTLIST_REQUEST_FLAG, REMAINING_FLAG].includes(process.argv[2]))) {
    throw new Error(`Run npm run test:email:customer:simulated without options (up to eleven sends), -- ${GUESTLIST_REQUEST_FLAG} (one send), or -- ${REMAINING_FLAG} (six sends).`);
  }
  const mockResult = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:email:customer:mocked'], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', RESEND_API_KEY: '', RESEND_TEST_READ_API_KEY: '', RESEND_FROM_EMAIL: '' },
  });
  if (mockResult.error) throw mockResult.error;
  if (mockResult.status !== 0) throw new Error('Mocked email tests failed; no simulator emails were sent.');

  dotenv.config({ path: path.join(root, '.env') });
  validateSettings(process.env);
  const readKey = process.env.RESEND_TEST_READ_API_KEY || process.env.RESEND_API_KEY;
  const runLabel = randomUUID().slice(0, 8);
  const messages = await collectWorkflowMessages(runLabel);
  validateWorkflowMessages(messages, runLabel);
  const selected = selectMessages(messages, process.argv.slice(2));
  await preflight(selected, readKey);

  const sends = [];
  for (const message of selected) {
    try {
      const id = await sendTemplate({ apiKey: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL,
        to: message.to, templateAlias: message.template, variables: message.variables, dedupeKey: message.key });
      sends.push({ ...message, id });
      process.stdout.write(`Accepted: ${message.action} (${id})\n`);
      await pause(150);
    } catch (error) {
      throw new Error(`Stopped after ${sends.length} accepted send(s); ${message.action} failed (${error.code || error.status || error.message}). Inspect the printed IDs before rerunning.`);
    }
  }
  await verifyDelivered(sends, readKey);
  const label = selected.length === 1 ? 'The guestlist request email was'
    : selected.length === REMAINING_TEMPLATES.length ? 'The six remaining customer emails were'
      : 'All eleven action-triggered templates were';
  process.stdout.write(`${label} delivered. ${selected.length} simulator email${selected.length === 1 ? '' : 's'} counted toward the sending quota.\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { EXPECTED_TEMPLATES, GUESTLIST_REQUEST_FLAG, REMAINING_FLAG, REMAINING_TEMPLATES,
  validateSettings, validateWorkflowMessages, selectMessages, preflight, verifyDelivered };
