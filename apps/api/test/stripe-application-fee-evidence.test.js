const test = require('node:test');
const assert = require('node:assert/strict');
const {verifyApplicationFeeEvidence}=require('../stripe-tests/application-fee-check.cjs');

function fixture() {
  const order={stripeChargeId:'ch_test',stripePaymentIntentId:'pi_test',applicationFeeCents:135,totalCents:2200,currency:'USD'};
  const charge={id:'ch_test',payment_intent:'pi_test',livemode:false,application_fee:'fee_test',
    balance_transaction:{id:'txn_merchant',source:'ch_test',currency:'usd',amount:2200,fee:235,net:1965}};
  const fee={id:'fee_test',account:'acct_test',charge:'ch_test',livemode:false,amount:135,amount_refunded:0,currency:'usd',balance_transaction:'txn_platform'};
  const platform={id:'txn_platform',source:'fee_test',type:'application_fee',currency:'usd',amount:135,fee:0,net:135};
  return {order,charge,fee,platform};
}

test('application fee evidence distinguishes merchant processing deductions from Nitewide revenue',()=>{
  const f=fixture();
  assert.deepEqual(verifyApplicationFeeEvidence(f.order,'acct_test',f.charge,f.fee,f.platform),{
    applicationFeeCents:135,nitewideNetCents:135,merchantGrossCents:2200,merchantNetCents:1965,merchantOtherFeesCents:100,currency:'USD'});
});

test('fee verification rejects live, differently scoped, incorrect and double-charged evidence',()=>{
  for(const mutate of [f=>f.charge.livemode=true,f=>f.charge.id='ch_other',f=>f.charge.payment_intent='pi_other',
    f=>f.fee.account='acct_other',f=>f.fee.charge='ch_other',f=>f.fee.amount=999,f=>f.fee.livemode=true,
    f=>f.fee.amount_refunded=1,f=>f.platform.source='fee_other',f=>f.platform.fee=100,
    f=>f.platform.net=35,f=>f.platform.currency='eur',f=>f.charge.balance_transaction.net=2200,
    f=>f.charge.balance_transaction.fee=0,f=>f.charge.balance_transaction=null]) {
    const f=fixture();mutate(f);
    assert.throws(()=>verifyApplicationFeeEvidence(f.order,'acct_test',f.charge,f.fee,f.platform));
  }
});
