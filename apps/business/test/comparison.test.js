import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {comparePosh,matrixColumns,matrixRows,comparisonSources} from '../src/lib/comparison.js';
test('splash matrix uses all six slide-deck platforms and the same scoped capabilities',()=>{
  assert.deepEqual(matrixColumns,['Capability','Nitewide','Posh','Discotech','Eventbrite','Sections.app','Tabler']);
  assert.equal(matrixRows.length,13);
  for(const row of matrixRows) assert.equal(row.length,matrixColumns.length);
  assert.equal(matrixRows.find(r=>r[0]==='Individualized commissions and reporting')[2],'Yes');
  assert.equal(matrixRows.find(r=>r[0]==='Competitor caps with a margin floor')[1],'Yes');
  assert.equal(matrixRows.find(r=>r[0]==='Cross-venue rebooking automation')[1],'In dev');
  for(const source of comparisonSources) assert.equal(new URL(source.url).protocol,'https:');
});
test('public calculator matches the two slide examples and excludes Nitewide net',()=>{
  for(const [price,quantity,total,fee,eb] of [[25,3,8340,840,8557],[300,1,32152,2152,32196]]) {
    const r=comparePosh({ticketPrice:price,quantity,orders:2});
    assert.equal(r.eligible,true); assert.equal(r.nitewideTotalCents,total); assert.equal(r.platformCents,fee);
    assert.equal(r.eventbriteTotalCents,eb); assert.equal(r.organizerNetCents,price*quantity*100);
    assert.equal(r.aggregateSavingsCents,r.savingsCents*2);
    for(const key of ['nitewideNetCents','contributionCents','stripeProcessingCents','preferredContributionCents']) assert.equal(key in r,false);
  }
  const source=readFileSync(new URL('../src/components/fee-comparison.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Nitewide net|nitewideNetCents|contributionCents/);
});
test('minimum-cost adjustments remain purchasable and show genuine comparative cost',()=>{
  const r=comparePosh({ticketPrice:1,quantity:1,orders:100});
  assert.equal(r.eligible,true); assert.equal(r.floorAdjusted,true);
  assert.equal(r.nitewideTotalCents,237); assert.equal(r.organizerNetCents,100);
  assert.equal(r.savingsCents,-28); assert.equal(r.aggregateSavingsCents,-2800);
});
test('supported eligible baskets beat both competitors with no extra processing surcharge',()=>{
  for(const quantity of [1,3,100]) for(let cents=1;cents<=100000;cents+=37){
    const r=comparePosh({ticketPrice:cents/100,quantity,orders:1});
    if(!r.eligible) continue;
    if(!r.floorAdjusted) assert.ok(r.platformCents*100<=Math.min(r.poshFeeCents,r.eventbriteServiceCents+r.eventbriteProcessingCents)*98);
    assert.equal(r.nitewideTotalCents,r.subtotalCents+r.platformCents);
    assert.equal(r.organizerNetCents,r.subtotalCents);
  }
});
test('invalid calculator inputs are rejected',()=>{
  const base={ticketPrice:20,quantity:1,orders:1};
  for(const ticketPrice of [NaN,Infinity,0,.009,-1,10001]) assert.equal(comparePosh({...base,ticketPrice}),null);
  for(const quantity of [0,-1,1.5,101]) assert.equal(comparePosh({...base,quantity}),null);
  for(const orders of [0,-1,1.5,100001]) assert.equal(comparePosh({...base,orders}),null);
});
