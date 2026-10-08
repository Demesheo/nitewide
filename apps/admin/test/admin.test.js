import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from '../src/lib/admin.js';

test('display helpers are deterministic', () => {
  assert.equal(formatMoney(12345), '$123.45');
  assert.equal(formatMoney(1), '$0.01');
});
