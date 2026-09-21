import test from 'node:test';
import assert from 'node:assert/strict';
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
