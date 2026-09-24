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

test('customer landing swaps the hero and event heading while keeping a compact mobile layout', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  const controls = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(app, /<h1>Find your kind of night\.<\/h1>/);
  assert.match(app, /The night is <span className="heading-accent">yours\.<\/span>/);
  assert.doesNotMatch(app, /LocateFixed|Your plans start here\./);
  assert.match(app, /Log in <LogIn size=\{16\}/);
  assert.match(css, /--surface-page: #08080b/);
  assert.match(css, /\.hero h1 \{[^}]*white-space: nowrap;/);
  assert.match(css, /\.section-heading h2 \.heading-accent \{[^}]*linear-gradient\(110deg, #d398a7, #c59bd0 60%, #ab9cd7\)/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.hero \{ padding-top: 18px; padding-bottom: 14px;/);
  assert.match(css, /\.hero-copy \{ padding-top: 0; \}/);
  assert.match(controls, /\.signin-button \{[^}]*height: 40px;[^}]*padding: 0 12px;[^}]*font-size: 12px;[^}]*gap: 7px;/);
  assert.match(css, /\.site-header \.header-actions > \.signin-button \{ height: 32px; min-height: 32px; \}/);
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
