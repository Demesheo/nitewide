const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteOrder, publicQuote, DEMO_COSTS, BENCHMARK, POLICY } = require('@nitewide/pricing');
const { calculatePricing, PLAN_POLICIES } = require('../src/domain/pricing');
const now = new Date('2026-09-23T12:00:00Z');
const quote = (price, quantity=1, extra={}) => quoteOrder({items:[{unitPriceCents:price,quantity}],now,...extra});

test('ceiling is 8% plus 80 cents per paid unit, with preferred 5% and hard $1 contribution', () => {
  assert.equal(POLICY.percentageBps,800); assert.equal(POLICY.perPaidUnitCents,80);
  assert.equal(POLICY.preferredMarginBps,500); assert.equal(POLICY.minimumContributionCents,100);
  assert.equal(PLAN_POLICIES.premium.monthlyFeeCents,24900);
});
test('three $25 tickets retain preferred margin; $300 VIP receives competitive discount and lower positive contribution', () => {
  const ga=quote(2500,3), vip=quote(30000);
  assert.equal(ga.feeCents,840); assert.equal(ga.totalCents,8340);
  assert.equal(ga.contributionCents,568); assert.equal(ga.preferredContributionCents,375);
  assert.equal(ga.preferredMarginMet,true);
  assert.equal(vip.ceilingFeeCents,2480); assert.equal(vip.feeCents,2152);
  assert.equal(vip.totalCents,32152); assert.equal(vip.discountCents,328);
  assert.equal(vip.processingCents,962); assert.equal(vip.contributionCents,1190);
  assert.equal(vip.preferredContributionCents,1500); assert.equal(vip.preferredMarginMet,false);
  assert.equal(vip.eligible,true);
});
test('free orders stay free; low-value paid orders get the smallest floor adjustment', () => {
  assert.equal(quote(0).totalCents,0);
  for(const cents of [1,100,1000]) { const q=quote(cents); assert.equal(q.eligible,true); assert.equal(q.contributionCents,100); assert.equal(q.floorAdjusted,true); assert.ok(q.feeCents>q.ceilingFeeCents); }
  assert.equal(quote(1000,2).eligible,true);
  assert.equal(calculatePricing({subtotalCents:1000,now}).totalCents,1164);
});
test('all supported paid quotes retain $1; competitive targets apply unless the floor overrides', () => {
  for(const quantity of [1,3,100]) for(let price=1;price<=100000;price+=7) {
    const q=quote(price,quantity);
    if(!q.eligible) { assert.equal(q.totalCents,null); continue; }
    if(!q.floorAdjusted) assert.ok(q.feeCents*100 <= Math.min(q.poshFeeCents,q.eventbriteFeeCents)*98);
    if(!q.floorAdjusted) assert.ok(q.feeCents<=q.ceilingFeeCents); assert.ok(q.contributionCents>=100);
    assert.equal(q.totalCents,q.subtotalCents+q.feeCents);
  }
});
test('mixed baskets and split lines preserve rounding and face-value commission', () => {
  const items=[{unitPriceCents:2500,quantity:3},{unitPriceCents:30000,quantity:1},{unitPriceCents:0,quantity:4}];
  const a=calculatePricing({subtotalCents:37500,items,commissionBps:1000,now});
  const b=calculatePricing({subtotalCents:37500,items:[...items.slice(1),{unitPriceCents:2500,quantity:1},{unitPriceCents:2500,quantity:2}],commissionBps:1000,now});
  assert.deepEqual(a,b); assert.equal(a.affiliateCommissionCents,3750);
  assert.equal(a.pricingPlanSnapshot.processingPaidBy,'platform');
});
test('cost floors include extra costs and reserves; unknown, negative, expired or mismatched inputs fail closed', () => {
  assert.equal(quote(2000,1,{costs:{...DEMO_COSTS,otherCostCents:100}}).contributionCents,100);
  assert.equal(quote(2000,1,{costs:{...DEMO_COSTS,reserveCents:100}}).contributionCents,100);
  for(const costs of [null,{}, {...DEMO_COSTS,reserveCents:-1}, {...DEMO_COSTS,processorBps:10000}])
    assert.equal(quote(2000,1,{costs}).reason,'COSTS_UNAVAILABLE');
  assert.equal(quote(2000,1,{currency:'EUR'}).eligible,false);
  assert.equal(quote(30000,1,{now:new Date(BENCHMARK.expiresAt)}).feeCents,2480);
  assert.equal(quote(2000,1,{benchmark:null}).benchmarkCurrent,false);
  assert.equal(quote(2000,1,{now:new Date('invalid')}).benchmarkCurrent,false);
});
test('public quote and order serializers never expose private contribution/cost data', () => {
  const q=quote(30000); const publicData=publicQuote(q);
  for(const key of ['contributionCents','processingCents','preferredContributionCents','reserveCents']) assert.equal(key in publicData,false);
  const {customerOrder}=require('../src/controllers/commerce-controller');
  const result=customerOrder({totalCents:q.totalCents,pricingPlanSnapshot:{demo:true,pricingDecision:q,minimumContributionCents:100}});
  assert.equal(result.pricingPlanSnapshot.demo,true);
  assert.equal(JSON.stringify(result).includes('contributionCents'),false);
  assert.equal('minimumContributionCents' in result.pricingPlanSnapshot,false);
});
test('unsafe or malformed amounts cannot produce a quote', () => {
  for(const price of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER]) assert.throws(()=>quote(price),RangeError);
  for(const quantity of [0,1.5,Infinity]) assert.throws(()=>quote(2000,quantity),RangeError);
  assert.throws(()=>calculatePricing({subtotalCents:1,items:[{unitPriceCents:2000,quantity:1}],now}),RangeError);
});
