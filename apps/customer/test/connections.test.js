import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectionEvents, connectionLink, selectedConnection, toggleConnectionSelection, applyConnectionSelection } from '../src/lib/connections.js';
import { referralFromSearch, referralCodeForEvent } from '../src/lib/referral.js';
const now = new Date('2026-09-22T12:00:00Z');
const event = { id: 'event', title: 'Friday at La Rosa', startsAt: '2026-09-25T22:00:00Z', location: { city: 'Orlando', region: 'FL', timezone: 'America/New_York' } };
const entries = [{ event, referrer: { id: 'alex', name: 'Alex' }, code: 'A-REF' }, { event, referrer: { id: 'sam', name: 'Sam' }, code: 'S-REF' }];
test('Connections deduplicates event cards while preserving every selectable referrer', () => {
  const groups = connectionEvents([...entries, entries[0]], {}, now);
  assert.equal(groups.length, 1); assert.equal(groups[0].referrals.length, 2);
  assert.equal(selectedConnection(groups[0], 'sam').code, 'S-REF');
  assert.equal(selectedConnection(groups[0], 'removed').code, 'A-REF');
});
test('person, city and search filters combine; stale/past/missing-code events never book', () => {
  assert.equal(connectionEvents(entries, { people: ['sam'], city: 'Orlando, FL', query: 'La Rosa Sam' }, now)[0].referrals.length, 1);
  assert.equal(connectionEvents(entries, { city: 'Miami, FL' }, now).length, 0);
  assert.equal(connectionEvents([{ ...entries[0], code: '' }, { ...entries[0], event: { ...event, startsAt: '2026-09-01' } }], {}, now).length, 0);
  const group = connectionEvents(entries, { people: ['sam'] }, now)[0];
  assert.equal(selectedConnection(group, 'alex').referrer.id, 'sam');
});
test('multi-select drafts are immutable, apply only valid IDs, and combine connections without duplicate events', () => {
  const applied = ['alex'];
  const draft = toggleConnectionSelection(applied, 'sam');
  assert.deepEqual(applied, ['alex']);
  assert.deepEqual(draft, ['alex', 'sam']);
  assert.equal(applyConnectionSelection(draft, ['alex', 'sam']), null);
  assert.deepEqual(applyConnectionSelection(['sam', 'removed', 'sam'], ['alex', 'sam']), ['sam']);
  assert.deepEqual(toggleConnectionSelection(draft, 'alex'), ['sam']);
  assert.equal(connectionEvents(entries, { people: draft }, now).length, 1);
  assert.equal(connectionEvents(entries, { people: [] }, now).length, 0);
});
test('multi-select applies explicitly and Booking with appears above the purchase action', async () => {
  const filter = await readFile(new URL('../src/components/connection-filter.jsx', import.meta.url), 'utf8');
  assert.match(filter, /onApply\(applyConnectionSelection\(draft, availableIds\)\)/);
  assert.match(filter, /onClick=\{\(\) => changeOpen\(false\)\}>Cancel/);
  assert.match(filter, /disabled=\{!selectedCount\}/);
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /referralCodeForEvent\(referral, selected.id\).*Booking with <strong>\{referral.referrerName\}<\/strong><\/p>\}\s*<Button\s*className="primary-action dark-glass-action"/);
  assert.doesNotMatch(app, /Referred by/);
});
test('shared connection links round-trip the chosen referral and are scoped to the new event', () => {
  const link = new URL(connectionLink(entries[1], 'https://nitewide.example'));
  const referral = referralFromSearch(link.search);
  assert.equal(link.origin, 'https://nitewide.example');
  assert.equal(referralCodeForEvent(referral, 'event'), 'S-REF');
  assert.equal(referralCodeForEvent(referral, 'different-event'), undefined);
});
test('connection events retain Premium-by-day ordering and names sort without mutating source entries', () => {
  const latePremium = { ...event, id: 'premium', title: 'Premium night', isPremiumHost: true, startsAt: '2026-09-25T23:00:00Z' };
  const tomorrowPremium = { ...latePremium, id: 'tomorrow', startsAt: '2026-09-26T23:00:00Z' };
  const input = [entries[1], entries[0], { ...entries[0], event: tomorrowPremium }, { ...entries[0], event: latePremium }];
  const before = structuredClone(input);
  const groups = connectionEvents(input, {}, now);
  assert.deepEqual(groups.map((group) => group.event.id), ['premium', 'event', 'tomorrow']);
  assert.deepEqual(groups[1].referrals.map((entry) => entry.referrer.name), ['Alex', 'Sam']);
  assert.deepEqual(input, before);
});
test('multi-select filters only preserve codes for the chosen connections across venues', () => {
  const otherVenue = { ...event, id: 'other-venue', organization: { name: 'Another venue' } };
  const input = [...entries, { ...entries[1], event: otherVenue, code: 'SAM-OTHER' }];
  const groups = connectionEvents(input, { people: ['sam'] }, now);
  assert.equal(groups.length, 2);
  for (const group of groups) {
    const choice = selectedConnection(group, 'alex');
    assert.equal(choice.referrer.id, 'sam');
    const referral = referralFromSearch(new URL(connectionLink(choice, 'https://nitewide.example')).search);
    assert.equal(referralCodeForEvent(referral, group.event.id), choice.code);
    assert.equal(referralCodeForEvent(referral, 'unrelated'), undefined);
  }
});
test('booking attribution is plain text with breathing room immediately before checkout confirmation', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  const checkout = app.slice(app.indexOf('className="checkout-review"'));
  assert.ok(checkout.indexOf('className="order-summary"') < checkout.indexOf('className="connection-context"'));
  assert.match(checkout, /className="connection-context">Booking with[^\n]+\n\s*<Button className="primary-action dark-glass-action" onClick=\{completeDemo\}/);
  const context = css.match(/\.connection-context\s*\{([^}]+)\}/)[1];
  for (const rule of ['margin: 12px 0', 'padding: 0', 'border: 0', 'background: none', 'box-shadow: none']) assert.ok(context.includes(rule), rule);
});
test('main navigation requires authenticated server eligibility, supports four segments and shares referral flow', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  assert.match(app, /Boolean\(session && connectionsHistory\?\.eligible\)/);
  assert.match(app, /\{hasConnections && <button/);
  assert.match(app, /onReferral=\{openConnection\}/);
  assert.match(css, /nav\[data-connections="true"\] \{ --tab-count: 4/);
  assert.match(css, /nav\[data-view="connections"\] \{ --tab-index: 3/);
  const hook = await readFile(new URL('../src/lib/use-connections.js', import.meta.url), 'utf8');
  assert.match(hook, /snapshot\?\.token === token/);
  assert.match(hook, /controller\.abort\(\)/);
});
