const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteOrder,publicQuote,DEMO_COSTS,effectiveFeeMode } = require('@nitewide/pricing');
const { calculatePricing } = require('../src/domain/pricing');
const { editorPricingIssues,validateEditorPricing } = require('../src/domain/editor-pricing-policy');
const now = new Date('2026-10-01T12:00:00Z');
const offering = extra => ({ name: 'Admission',priceCents: 1000,currency: 'USD',minPerOrder: 1,maxPerOrder: 10,isActive: true,feeMode: 'inherit',...extra });

test('fee inheritance and overrides preserve default buyer-paid amounts',() => {
  assert.equal(effectiveFeeMode('buyer','inherit'),'buyer');
  assert.equal(effectiveFeeMode('absorbed','inherit'),'absorbed');
  assert.equal(effectiveFeeMode('absorbed','buyer'),'buyer');
  assert.equal(effectiveFeeMode('buyer','absorbed'),'absorbed');
  assert.throws(() => effectiveFeeMode('mixed','inherit'),RangeError);
  const implicit = quoteOrder({ items: [{ unitPriceCents: 2500,quantity: 3 }],now });
  const explicit = quoteOrder({ items: [{ unitPriceCents: 2500,quantity: 3,feeMode: 'buyer' }],now,feeMode: 'buyer' });
  assert.deepEqual(implicit,explicit); assert.equal(implicit.feeCents,840); assert.equal(implicit.totalCents,8340);
});
test('absorbed $10 minimum and commission eligibility use the order subtotal, not charged fees',() => {
  const q = (price,extra = {}) => quoteOrder({ items: [{ unitPriceCents: price,quantity: 1 }],now,...extra });
  assert.equal(q(999,{ feeMode: 'absorbed' }).reason,'ABSORBED_MINIMUM_SUBTOTAL');
  const boundary = q(1000,{ feeMode: 'absorbed',commissionBps: 4000 });
  assert.equal(boundary.eligible,true); assert.equal(boundary.totalCents,1000); assert.equal(boundary.buyerFeeCents,0);
  assert.equal(boundary.businessFeeCents,boundary.feeCents); assert.equal(boundary.commissionCents,400);
  assert.equal(boundary.businessProceedsCents,1000-boundary.feeCents-400); assert.ok(boundary.contributionCents>=100);
  const small = calculatePricing({ subtotalCents: 999,commissionBps: 4000,now });
  assert.equal(small.affiliateCommissionCents,0); assert.equal(small.pricingPlanSnapshot.commissionBps,undefined);
  assert.equal(small.pricingPlanSnapshot.pricingDecision.commissionEligible,false);
  assert.ok(small.totalCents>1000,'buyer-added fees cannot make a small subtotal commission eligible');
});
test('mixed-mode baskets allocate the fee once, remain cent-exact and hide private economics',() => {
  const items = [{ unitPriceCents: 2500,quantity: 3,feeMode: 'buyer' },{ unitPriceCents: 30000,quantity: 1,feeMode: 'absorbed' }];
  const a = quoteOrder({ items,commissionBps: 1000,now });
  const b = quoteOrder({ items: [items[1],{ ...items[0],quantity: 1 },{ ...items[0],quantity: 2 }],commissionBps: 1000,now });
  assert.deepEqual(a,b); assert.equal(a.feeMode,'mixed');
  assert.equal(a.feeCents,a.buyerFeeCents+a.businessFeeCents);
  assert.equal(a.totalCents,a.subtotalCents+a.buyerFeeCents);
  assert.equal(a.businessProceedsCents,a.subtotalCents-a.businessFeeCents-a.commissionCents);
  const stored = calculatePricing({ subtotalCents: 37500,items,commissionBps: 1000,now });
  assert.equal(stored.platformFeeCents,a.buyerFeeCents); assert.equal(stored.totalCents,stored.platformFeeCents+37500);
  const customer = publicQuote(a); assert.equal(customer.feeCents,a.buyerFeeCents);
  for (const key of ['businessFeeCents','businessProceedsCents','commissionCents','contributionCents','processingCents']) assert.equal(key in customer,false);
  assert.equal(a.economicsBasis,'modeled_demo_costs');
});
test('the editor checks every allowed paid quantity and catches infeasible active draft prices',() => {
  assert.equal(editorPricingIssues({ eventFeeMode: 'absorbed',offerings: [offering()],now }).length,0);
  const issue = editorPricingIssues({ eventFeeMode: 'absorbed',offerings: [offering({ priceCents: 500,minPerOrder: 1,maxPerOrder: 2 })],now });
  assert.equal(issue[0].code,'ABSORBED_MINIMUM_SUBTOTAL'); assert.equal(issue[0].field,'minPerOrder');
  assert.equal(editorPricingIssues({ eventFeeMode: 'absorbed',offerings: [offering({ priceCents: 500,minPerOrder: 2,maxPerOrder: 4 })],now }).length,0);
  assert.equal(editorPricingIssues({ eventFeeMode: 'absorbed',offerings: [offering({ priceCents: 1,feeMode: 'buyer' })],now }).length,0);
  assert.equal(editorPricingIssues({ eventFeeMode: 'absorbed',offerings: [offering({ priceCents: 999,isActive: false }),offering({ priceCents: 0 })],now }).length,0);
  assert.throws(() => validateEditorPricing({ eventFeeMode: 'absorbed',offerings: [offering({ priceCents: 999 })],now }),error => error.code === 'PRICING_EDITOR_INVALID' && error.status === 422 && error.details.economicsBasis === 'modeled_demo_costs');
  const expensiveCosts = { ...DEMO_COSTS,processorFixedCents: 2000 };
  assert.equal(editorPricingIssues({ eventFeeMode: 'absorbed',offerings: [offering()],costs: expensiveCosts,commissionBps: 4000,now })[0].code,'NON_POSITIVE_BUSINESS_PROCEEDS');
});
test('absorbed and mixed quantity ranges retain the modeled floor without duplicate allocation',() => {
  for (const quantity of [1,2,3,10,100]) for (const price of [1000,1001,2500,10000,30000,100000000]) {
    for (const buyer of [false,true]) {
      const items = [{ unitPriceCents: price,quantity,feeMode: 'absorbed' },...(buyer ? [{ unitPriceCents: 1,quantity,feeMode: 'buyer' }] : [])];
      const q = quoteOrder({ items,commissionBps: 4000,now });
      assert.equal(q.eligible,true); assert.ok(q.contributionCents>=100); assert.ok(q.businessProceedsCents>0);
      assert.equal(q.feeCents,q.buyerFeeCents+q.businessFeeCents); assert.equal(q.totalCents,q.subtotalCents+q.buyerFeeCents);
    }
  }
});

test('active offering validation rejects malformed fee, currency, price and quantity inputs at the pure policy boundary', () => {
  const rows = [
    [{ currency: 'EUR' }, 'currency', 'UNSUPPORTED_CURRENCY'],
    [{ feeMode: 'mixed' }, 'feeMode', 'INVALID_FEE_MODE'],
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER].map(minPerOrder => [{ minPerOrder }, 'minPerOrder', 'INVALID_QUANTITY']),
    ...[0, 1.5, 101, NaN, Infinity].map(maxPerOrder => [{ maxPerOrder }, 'minPerOrder', 'INVALID_QUANTITY']),
    ...[-1, 0.5, 100000001, NaN, Infinity, '1000'].map(priceCents => [{ priceCents }, 'priceCents', 'INVALID_PRICE']),
  ];
  for (const [extra, field, code] of rows) {
    const issues = editorPricingIssues({ offerings: [offering({ isActive: false }), offering(extra)], now });
    assert.equal(issues.length, 1);
    assert.deepEqual({ index: issues[0].index, field: issues[0].field, code: issues[0].code }, { index: 1, field, code }, String(extra[field]));
    assert.ok(issues[0].message.length > 0);
  }
  assert.equal(editorPricingIssues({ eventFeeMode: 'mixed', offerings: [offering()], now })[0].code, 'INVALID_FEE_MODE');
  assert.equal(editorPricingIssues({ offerings: [offering({ minPerOrder: 3, maxPerOrder: 2 })], now })[0].code, 'INVALID_QUANTITY');
});

test('valid edge quantities and prices remain available, while inactive drafts do not block publishing', () => {
  for (const feeMode of ['buyer', 'absorbed']) for (const quantity of [1, 100]) for (const priceCents of [0, 1000, 100000000]) {
    assert.deepEqual(editorPricingIssues({ eventFeeMode: feeMode, offerings: [offering({ priceCents, minPerOrder: quantity, maxPerOrder: quantity })], now }), []);
  }
  assert.deepEqual(editorPricingIssues({ offerings: [offering({ currency: 'EUR', feeMode: 'mixed', priceCents: -1, minPerOrder: 0, isActive: false })], now }), []);
});

test('validation reports every invalid offering with stable field indices and the public error envelope', () => {
  const input = { offerings: [offering({ currency: 'EUR' }), offering({ feeMode: 'mixed' }), offering({ priceCents: -1 })], now };
  const issues = editorPricingIssues(input);
  assert.deepEqual(issues.map(({ index, field, code }) => ({ index, field, code })), [
    { index: 0, field: 'currency', code: 'UNSUPPORTED_CURRENCY' },
    { index: 1, field: 'feeMode', code: 'INVALID_FEE_MODE' },
    { index: 2, field: 'priceCents', code: 'INVALID_PRICE' },
  ]);
  assert.throws(() => validateEditorPricing(input), error => {
    assert.equal(error.status, 422); assert.equal(error.code, 'PRICING_EDITOR_INVALID');
    assert.equal(error.message, issues[0].message);
    assert.deepEqual(error.details, { issues, economicsBasis: 'modeled_demo_costs' });
    return true;
  });
  assert.equal(editorPricingIssues({ commissionBps: 4001, offerings: [offering()], now })[0].code, 'PRICING_CONFIGURATION_UNAVAILABLE');
});
