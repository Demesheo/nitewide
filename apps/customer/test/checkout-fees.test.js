import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutQuote } from '../src/lib/checkout-fees.js';
import { checkoutTotal, offeringAvailabilityLabel } from '../src/lib/discovery.js';

test('absorbed fees display an inclusive buyer total without exposing private economics', () => {
  const quote = checkoutQuote(1000, 1, 'USD', 'absorbed');
  assert.equal(quote.eligible, true);
  assert.equal(quote.subtotalCents, 1000);
  assert.equal(quote.feeCents, 0);
  assert.equal(quote.totalCents, 1000);
  for (const key of ['contributionCents', 'businessProceedsCents', 'businessFeeCents', 'modeledCostsCents']) {
    assert.equal(Object.hasOwn(quote, key), false);
  }
  assert.equal(checkoutTotal(500, 2, 'USD', 'absorbed').total, 1000);
  assert.equal(offeringAvailabilityLabel({ kind: 'ticket', saleState: 'on_sale', effectiveFeeMode: 'absorbed' }, []), 'Fees included');
});

test('buyer paid low-price purchases remain available and unsupported absorbed amounts do not show a viable quote', () => {
  assert.equal(checkoutQuote(500, 1, 'USD', 'buyer').eligible, true);
  assert.equal(checkoutQuote(500, 1, 'USD', 'absorbed').eligible, false);
  assert.equal(checkoutQuote(1000, 1, 'EUR', 'absorbed').eligible, false);
});
