import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectionEvents } from '../src/lib/connections.js';
import { customerPresentation } from '../src/lib/demo-visibility.js';
import { referralCodeForEvent } from '../src/lib/referral.js';

test('Discover connection options are event-scoped, deduplicated and exclude the debug owner', () => {
  const event = { id: 'chosen', title: 'Night', startsAt: '2099-01-01T22:00:00Z' };
  const entry = { event, code: 'REF', referrer: { id: 'person', name: 'Alex' } };
  const data = customerPresentation('/customer/connections?eventId=chosen', [entry, entry,
    { ...entry, referrer: { id: 'debug', name: 'Maya Portfolio Owner' } },
    { ...entry, event: { ...event, id: 'another' } }]);
  const options = connectionEvents(data).find((group) => group.event.id === 'chosen').referrals;
  assert.equal(options.length, 1);
  const referral = { eventId: options[0].event.id, code: options[0].code };
  assert.equal(referralCodeForEvent(referral, 'chosen'), 'REF');
  assert.equal(referralCodeForEvent(referral, 'another'), undefined);
  assert.equal(referralCodeForEvent(null, 'chosen'), undefined);
});
test('event picker supports direct choice, retains incoming links, and hides with no matches', async () => {
  const picker = await readFile(new URL('../src/components/event-connection-picker.jsx', import.meta.url), 'utf8');
  assert.match(picker, /customer\/connections\?eventId=/);
  assert.match(picker, /if \(!entries.length\) return null/);
  assert.match(picker, /value="direct">Book directly/);
  assert.match(picker, /Current link/);
  assert.match(picker, /controller.abort\(\)/);
  assert.match(picker, /Retry connections/);
  assert.match(picker, /disabled=\{busy\}/);
});
test('changing connection revalidates attribution without resetting tickets or quantity; actions wait for validation', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const handler = app.slice(app.indexOf('async function chooseEventConnection'), app.indexOf('function selectOffering'));
  assert.match(handler, /referral-visits/);
  assert.match(handler, /if \(!controller.signal.aborted\) setReferral/);
  assert.match(handler, /entry.event.id !== selected\?\.id/);
  assert.match(handler, /entry === null\) \{ setReferral\(null\)/);
  assert.doesNotMatch(handler, /openEvent\(|setQuantity\(|setOfferingId\(/);
  assert.match(app, /disabled=\{referralBusy \|\| !availableQuantity\(offering\)\}/);
  assert.match(app, /guestBusy \|\| referralBusy \|\|/);
  assert.match(app, /\{session && <EventConnectionPicker/);
});
