import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Discover stays focused on location, date and search without radar or extra filters', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /ON OUR RADAR|className="hero-art"|className="category-list"|className="expanded-filters"|setCategory|setPriceCap|setFiltersOpen/);
  assert.match(app, /Tickets, tables, guestlists\. Your night starts here\./);
  for (const name of ['city', 'date', 'query']) assert.ok(app.includes(`name="${name}"`));
  assert.match(app, /results\.sort\(compareEventListings\)/);
  assert.match(app, /filterUpcomingWeek\(events, filters\)/);
  assert.doesNotMatch(app, /Explore all upcoming events|We couldn’t find any experiences matching|All upcoming(?: dates)? <|KEEP THE NIGHT GOING/);
  assert.match(app, /Upcoming this week\./);
  assert.doesNotMatch(app, /Your people\.|Your own space\.|className="vip-banner wrap"/);
  assert.doesNotMatch(app, /✳|LESS PLANNING\. MORE DANCING\.|<small>\{num\}<\/small>/);
  for (const copy of ['FIND YOUR VIBE', 'Discover your scene', 'Book your spot', 'Make your entrance']) assert.ok(app.includes(copy));
  assert.match(css, /\.hero \{ grid-template-columns: minmax\(0, 1fr\)/);
});
