import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRecords, formatMoney, initials } from '../src/lib/admin.js';

test('search supports direct and derived nested fields', () => {
  const rows = [{ title: 'Friday Sessions', organization: { name: 'OHM' } }, { title: 'Sunday Service', organization: { name: 'Eden' } }];
  assert.equal(filterRecords(rows, 'ohm', ['title', (row) => row.organization.name]).length, 1);
  assert.equal(filterRecords(rows, 'SUNDAY', ['title']).length, 1);
  assert.equal(filterRecords(rows, '', ['title']).length, 2);
});

test('display helpers are deterministic', () => {
  assert.equal(formatMoney(12345), '$123');
  assert.equal(initials('Nitewide Admin'), 'NA');
});
