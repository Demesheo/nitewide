import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { salesMixSlices } from '../src/lib/sales-mix.js';

test('sales mix chart groups the long tail without losing revenue', () => {
  const rows = [
    { id: 'small', name: 'Small', salesCents: 100 },
    { id: 'large', name: 'Large', salesCents: 500 },
    { id: 'medium', name: 'Medium', salesCents: 300 },
    { id: 'zero', name: 'Unsold', salesCents: 0 },
  ];
  const slices = salesMixSlices(rows, 2);
  assert.deepEqual(slices.map(({ name, salesCents }) => [name, salesCents]), [['Large', 500], ['Medium', 300], ['Other', 100]]);
  assert.equal(slices.reduce((sum, row) => sum + row.salesCents, 0), 900);
  assert.deepEqual(salesMixSlices([{ id: 'zero', name: 'Unsold', salesCents: 0 }]), []);
});

test('event sales mix keeps each event date with its chart slice', () => {
  const [event] = salesMixSlices([{ id: 'event-1', name: 'Friday Night', dateLabel: '09/26/2026', salesCents: 500 }]);
  assert.equal(event.dateLabel, '09/26/2026');
  assert.equal(event.name, 'Friday Night');
});

test('Overview event sales mix displays venue-local dates while names can truncate on narrow screens', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const chart = readFileSync(new URL('../src/components/SalesMixPie.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(app, /eventDates = new Map\(data\.events\.map\(\(event\) => \[event\.id, eventDateLabel\(event\)\]\)\)/);
  assert.match(app, /dateLabel: eventDates\.get\(event\.id\)/);
  assert.match(chart, /mix-legend-date/);
  assert.match(css, /\.rank-title-name \{[^}]*text-overflow: ellipsis;/);
  assert.match(css, /\.event-sales-mix \.mix-legend \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
