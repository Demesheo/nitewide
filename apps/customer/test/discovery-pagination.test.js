import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const share = await readFile(new URL('../src/lib/event-share.js', import.meta.url), 'utf8');
const card = await readFile(new URL('../src/components/event-card.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Discover loads bounded server pages and requests the next page only after an explicit More action', () => {
  assert.match(app, /new URLSearchParams\(\{ pageSize: '9', city, startDate: start, endDate: end, query, timezone: discoveryTimezone \}\)/);
  assert.match(app, /const \[nextCursor, setNextCursor\] = useState\(null\)/);
  assert.match(app, /async function loadMore\(preview = false\)/);
  assert.match(app, /api\(discoveryUrl\(preview \? upcomingWeekRange\(date\) : discoveryRange, cursor\), \{ signal: controller\.signal \}\)/);
  assert.match(app, /onClick=\{\(\) => loadMore\(\)\}/);
  assert.doesNotMatch(app, /\/events\?limit=100/);
  assert.doesNotMatch(app, /while\s*\([^)]*nextCursor[^)]*\)\s*\{[^}]*api\(/);
});

test('filter changes and refreshes abort stale pages while preserving city, date, and search state', () => {
  assert.match(app, /const discoveryKey = JSON\.stringify\(\[city, date, query, discoveryTimezone\]\)/);
  assert.match(app, /moreRequest\.current\?\.abort\(\)/);
  assert.match(app, /if \(controller\.signal\.aborted \|\| key !== currentDiscoveryKey\.current\) return/);
  assert.match(app, /startDate: start, endDate: end, query, timezone: discoveryTimezone/);
  assert.match(app, /function loadEvents\(\) \{ setReloadRevision/);
});

test('date picker synchronizes native input edits into React state before applying filters', () => {
  assert.match(app, /name="date"[\s\S]*?onInput=\{\(event\) => setDate\(event\.currentTarget\.value\)\}[\s\S]*?onChange=\{\(event\) => setDate\(event\.target\.value\)\}[\s\S]*?onBlur=\{\(event\) => setDate\(event\.currentTarget\.value\)\}/);
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
  assert.match(app, /const \[previewEvents, setPreviewEvents\] = useState\(\[\]\)/);
  assert.match(app, /const \[previewCursor, setPreviewCursor\] = useState\(null\)/);
  assert.match(app, /setPreviewEvents\(\(previous\) => \[\.\.\.previous, \.\.\.prepareEvents\(page\.items\)\]\)/);
  assert.match(app, /!date \|\| loadState !== 'ready' \|\| events\.length/);
});

test('deep-linked event and saved event detail loads remain ID-based', () => {
  assert.match(share, /eventIdFromSearch/);
  assert.match(app, /api\(`\/events\/\$\{encodeURIComponent\(eventId\)\}`\)/);
  assert.match(app, /Promise\.all\(saved\.map\(\(id\) => api\(`\/events\/\$\{encodeURIComponent\(id\)\}`/);
});
