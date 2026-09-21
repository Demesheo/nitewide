import test from 'node:test';
import assert from 'node:assert/strict';
import { sortTableRows } from '../src/lib/table-sort.js';

test('management tables sort names A–Z by default and reverse on demand', () => {
  const rows = [{ name: 'Zoe', sales: 10 }, { name: 'Ava', sales: 40 }, { name: 'Maya', sales: 20 }];
  assert.deepEqual(sortTableRows(rows, 'name').map((row) => row.name), ['Ava', 'Maya', 'Zoe']);
  assert.deepEqual(sortTableRows(rows, 'name', true).map((row) => row.name), ['Zoe', 'Maya', 'Ava']);
  assert.deepEqual(sortTableRows(rows, 'sales', true).map((row) => row.name), ['Ava', 'Maya', 'Zoe']);
});
