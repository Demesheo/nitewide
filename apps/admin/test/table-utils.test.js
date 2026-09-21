import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZES, paginateRecords, sortRecords } from '../src/lib/table-utils.js';

test('admin tables sort names alphabetically and sales descending', () => {
  const rows = [{ name: 'Zoe', sales: 1 }, { name: 'Ava', sales: 3 }];
  assert.deepEqual(sortRecords(rows, (row) => row.name).map((row) => row.name), ['Ava', 'Zoe']);
  assert.deepEqual(sortRecords(rows, (row) => row.sales, true).map((row) => row.name), ['Ava', 'Zoe']);
});

test('admin tables paginate 10 by default with 25 and 50 options', () => {
  const rows = Array.from({ length: 63 }, (_, index) => index);
  assert.deepEqual(PAGE_SIZES, [10, 25, 50]);
  assert.equal(paginateRecords(rows).rows.length, 10);
  assert.equal(paginateRecords(rows, 2, 25).from, 26);
  assert.equal(paginateRecords(rows, 2, 50).to, 63);
});
