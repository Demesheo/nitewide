const test=require('node:test');
const assert=require('node:assert/strict');
const {canRequestRefund,paidBooking}=require('../src/domain/organizer-message-policy');
const {routePolicy}=require('../src/services/abuse-service');
test('refund request deadline is strictly before start and free claims never use payment refunds',()=>{
  const now=new Date('2026-10-02T12:00:00Z'),event={startsAt:now};
  for (const providerMode of ['test', 'live']) {
    const order={status:'paid',totalCents:1000,providerMode,providerVerificationStatus:'verified'};
    assert.equal(canRequestRefund(order,event,new Date(+now-1)),true);
    assert.equal(canRequestRefund(order,event,now),false);
    for (const invalid of [{totalCents:0}, {providerMode:'unknown'}, {providerMode:null},
      {providerVerificationStatus:'review'}, {providerVerificationStatus:'pending'}, {status:'pending'}, {status:'refunded'}]) {
      assert.equal(canRequestRefund({...order,...invalid},event,new Date(+now-1)),false);
    }
    assert.equal(paidBooking({...order,status:'pending'}),false);
  }
});
test('messaging and financial approval mutations have shared account and IP abuse protection',()=>{
  for(const path of ['/customer/orders/uuid/messages','/customer/messages/uuid/replies','/business/messages/uuid/read'])assert.equal(routePolicy('POST',path),'message');
  assert.equal(routePolicy('PATCH','/business/orders/uuid/refund-request'),'message');
  for(const path of ['/account/commission-payment-profile','/account/commission-payment-profile/synchronize','/business/organizations/uuid/commission-payments/quote'])assert.equal(routePolicy('POST',path),'commission_payment');
});
