import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const hook = await readFile(new URL('../src/lib/use-discovery.js', import.meta.url), 'utf8');
const results = await readFile(new URL('../src/components/discovery-results.jsx', import.meta.url), 'utf8');
const saved = await readFile(new URL('../src/lib/use-saved-events.js', import.meta.url), 'utf8');
const share = await readFile(new URL('../src/lib/event-share.js', import.meta.url), 'utf8');
const card = await readFile(new URL('../src/components/event-card.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Discover loads bounded server pages and requests the next page only after an explicit More action', () => {
  assert.match(hook, /new URLSearchParams\(\{ pageSize: '9', city: submitted\.city, startDate: start, endDate: end, query: submitted\.query, timezone \}\)/);
  assert.match(hook, /const \[nextCursor, setNextCursor\] = useState\(null\)/);
  assert.match(hook, /async function loadMore\(preview = false\)/);
  assert.match(hook, /api\(url\(preview \? upcomingWeekRange\(submitted\.date\) : range, cursor\), \{ signal: controller\.signal \}\)/);
  assert.match(results, /onClick=\{\(\) => loadMore\(\)\}/);
  assert.doesNotMatch(`${app}\n${hook}`, /\/events\?limit=100/);
  assert.doesNotMatch(hook, /while\s*\([^)]*nextCursor[^)]*\)\s*\{[^}]*api\(/);
});

test('filter changes and refreshes abort stale pages while preserving city, date, and search state', () => {
  assert.match(hook, /const key = JSON\.stringify\(\[submitted, timezone\]\)/);
  assert.match(hook, /moreRequest\.current\?\.abort\(\)/);
  assert.match(hook, /if \(controller\.signal\.aborted \|\| requestKey !== currentKey\.current\) return/);
  assert.match(hook, /startDate: start, endDate: end, query: submitted\.query, timezone/);
  assert.match(hook, /function reload\(\) \{ setReloadRevision/);
});

test('date picker synchronizes native input edits into React state before applying filters', () => {
  assert.match(app, /name="date"[\s\S]*?onInput=\{\(event\) => \{ setDate\(event\.currentTarget\.value\); setShortcut\(''\); \}\}[\s\S]*?onChange=\{\(event\) => \{ setDate\(event\.target\.value\); setShortcut\(''\); \}\}[\s\S]*?onBlur=\{\(event\) => setDate\(event\.currentTarget\.value\)\}/);
});

test('event card Save remains independent of Open and exposes its pressed state', () => {
  assert.match(card, /<button\s+type="button"\s+className=\{`save-button/);
  assert.match(card, /aria-pressed=\{saved\}[\s\S]*?onClick=\{\(click\) => \{ click\.stopPropagation\(\); onSave\?\.\(\); \}\}/);
  assert.match(card, /<article[^>]+onClick=\{\(click\) => \{ if \(!click\.target\.closest\('button'\)\) onOpen\?\.\(\); \}\}/);
  assert.match(card, /onClick=\{\(click\) => \{ click\.stopPropagation\(\); onSave\?\.\(\); \}\}/);
  assert.match(card, /<button\s+type="button"\s+className="card-open"[\s\S]*?onClick=\{\(click\) => \{ click\.stopPropagation\(\); onOpen\?\.\(\); \}\}/);
  assert.doesNotMatch(styles, /\.card-open::after\s*\{/);
});

test('date-specific next-week preview uses its own cursor and does not overwrite the selected-date result', () => {
  assert.match(hook, /const \[previewEvents, setPreviewEvents\] = useState\(\[\]\)/);
  assert.match(hook, /const \[previewCursor, setPreviewCursor\] = useState\(null\)/);
  assert.match(hook, /setPreviewEvents\(\(previous\) => \[\.\.\.previous, \.\.\.prepareEvents\(page\.items\)\]\)/);
  assert.match(hook, /!submitted\.date \|\| loadState !== 'ready' \|\| events\.length/);
  assert.match(results, /onClick=\{\(\) => loadMore\(true\)\}/);
});

test('deep-linked event and saved event detail loads remain ID-based', () => {
  assert.match(share, /eventIdFromSearch/);
  assert.match(app, /const eventId = initialRoute\.eventId/);
  assert.match(app, /api\(`\/events\/\$\{encodeURIComponent\(eventId\)\}`\)/);
  assert.match(app, /Promise\.all\(\[\s*api\(`\/events\/\$\{encodeURIComponent\(incoming\.eventId\)\}`\)/);
  assert.match(app, /useSavedEvents\(session, view/);
  assert.match(app, /parseCustomerRoute\(window\.location\.search\)/);
  assert.match(saved, /\/events\/batch\?ids=/);
});
