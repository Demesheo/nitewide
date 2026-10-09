const test = require('node:test');
const assert = require('node:assert/strict');
const {verifyDispute} = require('../src/services/stripe-dispute-service');
const order={id:'order',providerMode:'test',stripeChargeId:'ch_bound',stripePaymentIntentId:'pi_bound',totalCents:2200,applicationFeeCents:200,currency:'USD'};
const charge={id:'ch_bound',object:'charge',livemode:false,payment_intent:'pi_bound',paid:true,captured:true,amount:2200,currency:'usd',application_fee_amount:200};
const intent={id:'pi_bound',object:'payment_intent',livemode:false,metadata:{orderId:'order'},status:'succeeded',latest_charge:'ch_bound',amount:2200,currency:'usd',application_fee_amount:200};
const dispute={id:'du_bound',object:'dispute',livemode:false,charge:'ch_bound',payment_intent:'pi_bound',amount:2200,currency:'usd',status:'under_review'};
test('purchase dispute evidence binds original sandbox charge, intent, amount, currency and application fee',()=>{
  assert.equal(verifyDispute(order,dispute,charge,intent),true);
  assert.equal(verifyDispute(order,{...dispute,amount:2201},charge,intent),true,'independently bound FX-adjusted dispute still holds the purchase');
  for(const patch of [{livemode:true},{object:'other'},{charge:'ch_other'},{payment_intent:'pi_other'},{currency:'eur'},{amount:0},{status:'invented'}]) assert.equal(verifyDispute(order,{...dispute,...patch},charge,intent),false);
  for(const patch of [{captured:false},{amount:2100},{application_fee_amount:201},{livemode:true}]) assert.equal(verifyDispute(order,dispute,{...charge,...patch},intent),false);
  for(const patch of [{metadata:{orderId:'other'}},{latest_charge:'ch_other'},{status:'processing'},{application_fee_amount:201}]) assert.equal(verifyDispute(order,dispute,charge,{...intent,...patch}),false);
});
test('live disputes require matching live purchase, charge and intent evidence',()=>{
  const liveOrder={...order,providerMode:'live'},liveDispute={...dispute,livemode:true},liveCharge={...charge,livemode:true},liveIntent={...intent,livemode:true};
  assert.equal(verifyDispute(liveOrder,liveDispute,liveCharge,liveIntent),true);
  assert.equal(verifyDispute(order,liveDispute,liveCharge,liveIntent),false);
  for(const value of [false,undefined,null,'true']) {
    assert.equal(verifyDispute(liveOrder,{...liveDispute,livemode:value},liveCharge,liveIntent),false);
    assert.equal(verifyDispute(liveOrder,liveDispute,{...liveCharge,livemode:value},liveIntent),false);
    assert.equal(verifyDispute(liveOrder,liveDispute,liveCharge,{...liveIntent,livemode:value}),false);
  }
});
