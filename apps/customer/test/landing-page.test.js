import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Discover stays focused on location, date and search without radar or extra filters', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /ON OUR RADAR|className="hero-art"|className="category-list"|className="expanded-filters"|setCategory|setPriceCap|setFiltersOpen/);
  assert.doesNotMatch(app, /hero-tags|Tickets, tables, guestlists\. Your night starts here\.|VIP tables|GOOD COMPANY\. GREAT NIGHTS\./);
  for (const name of ['city', 'date', 'query']) assert.ok(app.includes(`name="${name}"`));
  assert.match(app, /filterDiscoveryEvents\(events, filters\)/);
  assert.match(app, /filterUpcomingWeek\(events, filters\)/);
  assert.doesNotMatch(app, /Explore all upcoming events|We couldn’t find any experiences matching|All upcoming(?: dates)? <|KEEP THE NIGHT GOING/);
  assert.match(app, /Upcoming this week\./);
  assert.doesNotMatch(app, /Your people\.|Your own space\.|className="vip-banner wrap"/);
  assert.doesNotMatch(app, /✳|LESS PLANNING\. MORE DANCING\.|<small>\{num\}<\/small>/);
  for (const copy of ['FIND YOUR VIBE', 'Discover your scene', 'Book your spot', 'Make your entrance']) assert.ok(app.includes(copy));
  assert.match(css, /\.hero \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test('customer landing keeps the hero on one line with a darker page and compact login control', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  const controls = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(app, /The night\{' '\}\s*<span className="hero-accent">is yours\.<\/span>/);
  assert.match(app, /Sign in <LogIn size=\{16\}/);
  assert.match(css, /--surface-page: #08080b/);
  assert.match(css, /\.hero h1 \{[^}]*white-space: nowrap;/);
  assert.match(controls, /\.signin-button \{[^}]*height: 40px;[^}]*padding: 0 12px;[^}]*font-size: 12px;[^}]*gap: 7px;/);
});

test('event details and discovery cards omit redundant nightlife labels', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const card = await readFile(new URL('../src/components/event-card.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /YOUR NIGHT STARTS HERE|className="hero-tags"/);
  assert.doesNotMatch(card, /AFTER DARK/);
  assert.match(card, /event\.category !== "nightlife"/);
});

test('event details place the title beside a right-aligned close control on iPhone', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const mobile = await readFile(new URL('../src/mobile.css', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(app, /data-event-stage=\{stage\}/);
  assert.match(mobile, /\.event-modal\[data-event-stage="details"\] > \[data-slot="dialog-close"\]\s*\{[^}]*position: absolute; top: 16px; right: 16px/);
  assert.match(css, /\.event-modal\[data-event-stage="details"\] > \[data-slot="dialog-close"\]\s*\{[^}]*width: 44px;[^}]*height: 44px;[^}]*border-radius: 50%;[^}]*opacity: 1;/);
  assert.match(css, /\.event-modal\[data-event-stage="details"\] > \[data-slot="dialog-close"\] svg\s*\{[^}]*width: 18px;[^}]*height: 18px;/);
});

test('iPhone footer keeps the cities in a right-aligned column beside the brand', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.site-footer\s*\{\s*grid-template-columns: auto minmax\(0, 1fr\);/);
  assert.match(css, /\.site-footer \.footer-markets\s*\{[^}]*grid-column: 2;[^}]*grid-row: 1;[^}]*text-align: right;/);
  assert.match(css, /\.site-footer:has\(\.footer-business\)\s*\{\s*grid-template-columns: auto auto minmax\(0, 1fr\);/);
});
