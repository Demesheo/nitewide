import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPerformancePeople, normalizePerformancePeople } from '../src/lib/performance-roles.js';

test('legacy report rows still appear under manager and promoter selections', () => {
  const people = normalizePerformancePeople([
    { id: 'manager', role: 'Employee', salesCents: 0 },
    { id: 'promoter', role: 'Affiliate', salesCents: 1000 },
  ]);
  assert.deepEqual(filterPerformancePeople(people, ['Manager']).map(({ id }) => id), ['manager']);
  assert.deepEqual(filterPerformancePeople(people, ['Promoter']).map(({ id }) => id), ['promoter']);
});

test('current employee and promoter rows retain their distinct roles', () => {
  const people = normalizePerformancePeople([
    { id: 'employee', role: 'Employee' },
    { id: 'manager', role: 'Manager' },
    { id: 'promoter', role: 'Promoter' },
  ]);
  assert.deepEqual(filterPerformancePeople(people, ['Employee']).map(({ id }) => id), ['employee']);
  assert.deepEqual(filterPerformancePeople(people, ['Manager']).map(({ id }) => id), ['manager']);
  assert.deepEqual(filterPerformancePeople(people, ['Promoter']).map(({ id }) => id), ['promoter']);
  assert.deepEqual(filterPerformancePeople(people, []).map(({ id }) => id), ['employee', 'manager', 'promoter']);
  assert.deepEqual(filterPerformancePeople(people, ['Manager', 'Promoter']).map(({ id }) => id), ['manager', 'promoter']);
});
