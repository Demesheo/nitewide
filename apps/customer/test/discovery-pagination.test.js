import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadRundownEvent } from '../src/lib/rundown-event.js';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const hook = await readFile(new URL('../src/lib/use-discovery.js', import.meta.url), 'utf8');
const results = await readFile(new URL('../src/components/discovery-results.jsx', import.meta.url), 'utf8');
const saved = await readFile(new URL('../src/lib/use-saved-events.js', import.meta.url), 'utf8');
const share = await readFile(new URL('../src/lib/event-share.js', import.meta.url), 'utf8');
const card = await readFile(new URL('../src/components/event-card.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('event card Save remains independent of Open and exposes its pressed state', () => {
  assert.match(card, /<button\s+type="button"\s+className=\{`save-button/);
  assert.match(card, /aria-pressed=\{saved\}[\s\S]*?onClick=\{\(click\) => \{ click\.stopPropagation\(\); onSave\?\.\(\); \}\}/);
  assert.match(card, /<article[^>]+onClick=\{\(click\) => \{ if \(!click\.target\.closest\('button, a'\)\) onOpen\?\.\(\); \}\}/);
  assert.match(card, /onClick=\{\(click\) => \{ click\.stopPropagation\(\); onSave\?\.\(\); \}\}/);
  assert.match(card, /<a\s+href=\{eventPublicHref\(event\.id, event\.referralCode\)\}\s+className="card-open"[\s\S]*?ordinaryLinkClick\(click\)[\s\S]*?click\.preventDefault\(\); click\.stopPropagation\(\); onOpen\(\);/);
  assert.doesNotMatch(styles, /\.card-open::after\s*\{/);
});

test('date-specific next-week preview uses its own cursor and does not overwrite the selected-date result', () => {
  assert.match(hook, /previewEvents: \[\], previewCursor: null/);
  assert.match(hook, /previewEvents: \[\.\.\.previous\.previewEvents, \.\.\.prepareEvents\(page\.items\)\]/);
  assert.match(hook, /!submitted\.date \|\| loadState !== 'ready' \|\| events\.length \|\| !confirmedDiscoveryScope\(visible\.area, resolutionStatus\) \|\| hasUpcomingAreaEvents === false/);
  assert.match(results, /onClick=\{\(\) => loadMore\(true\)\}/);
});

test('deep-linked event and saved event detail loads remain ID-based', async () => {
  assert.match(share, /eventIdFromSearch/);
  assert.match(app, /const eventId = initialRoute\.eventId/);
  assert.match(app, /loadRundownEvent\(\{ eventId, code: incoming\?\.code/);
  // The shared guarded detail loader now owns both ordinary and referred deep
  // links. Verify requests, rather than requiring their old inline spelling.
  const eventId = '61daf017-d30c-4030-9b89-dd29d875ddaf';
  for (const code of [null, 'REF-example']) {
    const calls = [];
    const loaded = await loadRundownEvent({ eventId, code, sessionKey: 'session' }, async (path, options) => {
      calls.push({ path, options });
      return path.endsWith('/referral-visits') ? { code, referrerName: 'Host' } : { id: eventId };
    });
    assert.equal(loaded.event.id, eventId);
    assert.equal(calls[0].path, `/events/${eventId}`);
    assert.equal(calls.length, code ? 2 : 1);
    if (code) {
      assert.equal(calls[1].path, `/events/${eventId}/referral-visits`);
      assert.deepEqual(calls[1].options.body, { code, sessionKey: 'session' });
      assert.equal(loaded.referral.code, code);
    } else assert.equal(loaded.referral, null);
  }
  assert.match(app, /useSavedEvents\(session, view/);
  assert.match(app, /parseCustomerRoute\(window\.location\.search\)/);
  assert.match(saved, /\/events\/batch\?ids=/);
});
