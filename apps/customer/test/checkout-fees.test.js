import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutQuote } from '../src/lib/checkout-fees.js';
import { checkoutTotal, offeringAvailabilityLabel, offeringPrice, eventStartingPrice, feeLabel, money } from '../src/lib/discovery.js';

test('absorbed fees display an inclusive buyer total without exposing private economics', () => {
  const quote = checkoutQuote(1000, 1, 'USD', 'absorbed');
  assert.equal(quote.eligible, true);
  assert.equal(quote.subtotalCents, 1000);
  assert.equal(quote.feeCents, 0);
  assert.equal(quote.totalCents, 1000);
  assert.equal(quote.includedFeeCents, 160);
  for (const key of ['contributionCents', 'businessProceedsCents', 'businessFeeCents', 'modeledCostsCents']) {
    assert.equal(Object.hasOwn(quote, key), false);
  }
  assert.equal(checkoutTotal(500, 2, 'USD', 'absorbed').total, 1000);
  assert.equal(offeringAvailabilityLabel({ kind: 'ticket', priceCents: 1000, saleState: 'on_sale', effectiveFeeMode: 'absorbed' }, []), '$1.60 fees included');
});

test('buyer paid low-price purchases remain available and unsupported absorbed amounts do not show a viable quote', () => {
  assert.equal(checkoutQuote(500, 1, 'USD', 'buyer').eligible, true);
  assert.equal(checkoutQuote(500, 1, 'USD', 'absorbed').eligible, false);
  assert.equal(checkoutQuote(1000, 1, 'EUR', 'absorbed').eligible, false);
});

test('customer-paid fee captions describe the amount already included in the upfront total', () => {
  const quote = offeringPrice({ priceCents: 1000, currency: 'USD', effectiveFeeMode: 'buyer' });
  assert.equal(quote.total, 1164);
  assert.equal(quote.fee, 164);
  assert.equal(feeLabel(quote), '$1.64 fees included');
});

test('upfront prices itemize the real order fee without adding absorbed fees or multiplying a single-unit floor', () => {
  for (const quantity of [1, 2, 5]) {
    for (const mode of ['buyer', 'absorbed']) {
      const offering = { priceCents: 2500, currency: 'USD', effectiveFeeMode: mode };
      const quote = offeringPrice(offering, quantity);
      assert.equal(quote.total, quote.subtotal + quote.fee);
      assert.equal(quote.quantity, quantity);
      assert.equal(mode === 'buyer' ? quote.fee : quote.includedFee, 280 * quantity);
      assert.equal(feeLabel(quote), `${money(280 * quantity)} fees included`);
      assert.equal(offeringAvailabilityLabel(offering, [], quantity), feeLabel(quote));
    }
  }
  const lowPrice = { priceCents: 100, effectiveFeeMode: 'buyer' };
  assert.notEqual(offeringPrice(lowPrice, 2).fee, offeringPrice(lowPrice, 1).fee * 2, 'the order floor is quoted once for the actual quantity');
  for (const effectiveFeeMode of ['buyer', 'absorbed']) {
    assert.equal(feeLabel(offeringPrice({ priceCents: 0, effectiveFeeMode }, 4)), '');
  }
  assert.equal(feeLabel(checkoutTotal(500, 1, 'USD', 'absorbed')), '');
  assert.equal(offeringAvailabilityLabel({ priceCents: 500, effectiveFeeMode: 'absorbed' }), 'Pricing unavailable');
  assert.equal(feeLabel({ eligible: true, total: 4500, subtotal: 4000, fee: 500 }), '$5 fees included', 'restored bookings itemize their original recorded buyer fee');
  assert.equal(feeLabel({ eligible: true, total: 4000, subtotal: 4000, fee: 0 }), '', 'old bookings without an absorbed-fee snapshot are not repriced');
});

test('event starting prices compare obtainable all-in totals and preserve free and guestlist-only events', () => {
  const buyer = { id: 'buyer', priceCents: 1000, effectiveFeeMode: 'buyer' };
  const absorbed = { id: 'absorbed', priceCents: 1100, effectiveFeeMode: 'absorbed' };
  assert.equal(eventStartingPrice({ offerings: [buyer, absorbed] }).total, 1100, 'lowest face value is not necessarily the lowest total');
  const minimum = { priceCents: 500, minPerOrder: 2, effectiveFeeMode: 'absorbed' };
  assert.equal(eventStartingPrice({ offerings: [minimum] }).total, 1000);
  assert.equal(eventStartingPrice({ offerings: [minimum] }).quantity, 2);
  assert.equal(feeLabel(eventStartingPrice({ offerings: [minimum] })), '$2.40 fees included');
  assert.equal(eventStartingPrice({ offerings: [{ ...buyer, saleState: 'sold_out' }, absorbed] }).total, 1100);
  assert.equal(eventStartingPrice({ offerings: [{ ...buyer, saleState: 'scheduled' }] }), null);
  assert.equal(eventStartingPrice({ offerings: [{ priceCents: 500, effectiveFeeMode: 'absorbed' }] }), null);
  assert.equal(eventStartingPrice({ offerings: [{ ...buyer, currency: 'EUR' }] }), null);
  assert.equal(eventStartingPrice({ offerings: [{ priceCents: 0 }, buyer] }).total, 0);
  assert.equal(eventStartingPrice({ offerings: [] }), null);
});
