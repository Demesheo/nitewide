import test from 'node:test';
import assert from 'node:assert/strict';
import { explorerView, hasMultipleRegions, sortExplorerRows } from '../src/lib/analytics-explorer.js';

const rows = [
  { id: 'region:Orlando', level: 'region', label: 'Orlando', salesCents: 300 },
  { id: 'region:Orlando:entity:org', level: 'entity', label: 'Venue', salesCents: 300 },
  { id: 'event:e1', level: 'event', label: 'Friday', salesCents: 300 },
  { id: 'customer:e1:u1', level: 'customer', label: 'Ava', salesCents: 300 },
];
const children = { all: ['region:Orlando'], 'region:Orlando': ['region:Orlando:entity:org'], 'region:Orlando:entity:org': ['event:e1'], 'event:e1': ['customer:e1:u1'] };

test('single-region businesses start with venues, then events, then customers', () => {
  const data = { hierarchy: rows, children, options: { regions: ['Orlando'] } };
  assert.equal(hasMultipleRegions(data), false);
  assert.deepEqual(explorerView(data).rows.map((row) => row.label), ['Venue']);
  assert.equal(explorerView(data).level, 'entity');
  assert.equal(explorerView(data, [rows[1].id]).level, 'event');
  assert.deepEqual(explorerView(data, [rows[1].id, rows[2].id]).rows.map((row) => row.label), ['Ava']);
  assert.equal(explorerView(data, [rows[1].id, rows[2].id]).level, 'customer');
});

test('multi-region businesses retain the region level and sortable sales', () => {
  const data = { hierarchy: rows, children, options: { regions: ['Orlando', 'Miami'] } };
  assert.equal(explorerView(data).level, 'region');
  assert.deepEqual(sortExplorerRows([{ label: 'Low', salesCents: 1 }, { label: 'High', salesCents: 2 }]).map((row) => row.label), ['High', 'Low']);
});
