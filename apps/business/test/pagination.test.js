import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate, PAGE_SIZES } from '../src/lib/pagination.js';

test('tables default to 10 rows and support 25 and 50 without losing records', () => {
  const rows = Array.from({ length: 61 }, (_, index) => index + 1);
  assert.deepEqual(PAGE_SIZES, [10, 25, 50]);
  assert.deepEqual(paginate(rows).rows, rows.slice(0, 10));
  assert.deepEqual(paginate(rows, 2, 25).rows, rows.slice(25, 50));
  assert.deepEqual(paginate(rows, 2, 50).rows, rows.slice(50));
  assert.deepEqual(paginate(rows, 99, 10).rows, [61]);
  assert.deepEqual([paginate([], 1, 10).from, paginate([], 1, 10).to], [0, 0]);
});
