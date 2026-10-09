const test = require('node:test');
const assert = require('node:assert/strict');
const {createStripeDisconnect} = require('../src/payments/stripe-disconnect');
const {paymentsReady,RESPONSIBILITIES} = require('../src/services/business-payment-account-service');
function fixture(mode = 'test') {
  const calls=[];
  const remote={id:'acct_fixture',object:'v2.core.account',livemode:mode==='live',dashboard:'full',defaults:{responsibilities:{...RESPONSIBILITIES,requirements_collector:'stripe'}}};
  const standard={id:remote.id,type:'standard',controller:{stripe_dashboard:{type:'full'},losses:{payments:'stripe'}}};
  const sdk={v2:{core:{accounts:{retrieve:async()=>remote}}},accounts:{retrieve:async()=>standard},
    disputes:{list:async(params,options)=>{calls.push(['disputes',params,options]);return {data:[],has_more:false};}},
    oauth:{deauthorize:async params=>{calls.push(['deauthorize',params]);return {stripe_user_id:remote.id};}}};
  return {calls,remote,standard,sdk,service:createStripeDisconnect(sdk,'ca_fixture',mode)};
}
test('disconnect uses Standard deauthorization, not account deletion, with scoped dispute checks',async()=>{
  const f=fixture();assert.deepEqual(await f.service.disconnect('acct_fixture'),{disconnected:true});
  assert.deepEqual(f.calls,[['disputes',{limit:100},{stripeAccount:'acct_fixture'}],['deauthorize',{client_id:'ca_fixture',stripe_user_id:'acct_fixture'}]]);
});
test('disconnect refuses missing client ID, wrong merchant, mismatched mode and controlled accounts before external revocation',async()=>{
  await assert.rejects(createStripeDisconnect({},null).disconnect('acct_fixture'),{code:'DISCONNECT_NOT_CONFIGURED'});
  for(const mutate of [f=>f.remote.id='acct_other',f=>f.remote.livemode=true,f=>f.remote.closed=true,
    f=>f.standard.type='express',f=>f.standard.id='acct_other',f=>f.remote.defaults.responsibilities.losses_collector='application']) {
    const f=fixture();mutate(f);await assert.rejects(f.service.disconnect('acct_fixture'),{code:'DISCONNECT_NOT_SUPPORTED'});assert.equal(f.calls.length,0);
  }
});
test('live disconnect verifies the merchant mode and never revokes mismatched or unverified accounts', async () => {
  const live = fixture('live');
  assert.deepEqual(await live.service.disconnect('acct_fixture'), { disconnected: true });
  assert.equal(live.calls.filter(([name]) => name === 'deauthorize').length, 1);
  for (const value of [false, undefined, null, 'true', 1]) {
    const f = fixture('live'); f.remote.livemode = value;
    await assert.rejects(f.service.disconnect('acct_fixture'), { code: 'DISCONNECT_NOT_SUPPORTED' });
    assert.equal(f.calls.length, 0);
  }
  const disabled = fixture('disabled');
  await assert.rejects(disabled.service.disconnect('acct_fixture'), { code: 'DISCONNECT_NOT_CONFIGURED' });
  assert.equal(disabled.calls.length, 0);
});
test('open disputes and unbounded/unverifiable dispute history block provider disconnection',async()=>{
  for(const status of ['needs_response','under_review','warning_needs_response','warning_under_review']) {
    const f=fixture();f.sdk.disputes.list=async()=>({data:[{id:'dp_open',status}],has_more:false});
    await assert.rejects(f.service.disconnect('acct_fixture'),{code:'DISCONNECT_OBLIGATIONS'});assert.equal(f.calls.length,0);
  }
  const f=fixture();let pages=0;f.sdk.disputes.list=async()=>{pages++;return {data:[{id:`dp_${pages}`,status:'won'}],has_more:true};};
  await assert.rejects(f.service.disconnect('acct_fixture'),{code:'DISCONNECT_OBLIGATIONS'});assert.equal(pages,10);assert.equal(f.calls.length,0);
});
test('provider timeouts and mismatched acknowledgments never prove disconnection',async()=>{
  const f=fixture();f.sdk.oauth.deauthorize=async()=>({stripe_user_id:'acct_other'});
  await assert.rejects(f.service.disconnect('acct_fixture'),/did not match/);
  f.sdk.oauth.deauthorize=async()=>{throw new Error('network');};await assert.rejects(f.service.disconnect('acct_fixture'),/network/);
});
test('Stripe controlled-account refusal is explicit and never falls back to closing an account',async()=>{
  const f=fixture();f.sdk.oauth.deauthorize=async()=>{throw Object.assign(new Error('provider details'),{rawType:'no_deauth_on_controlled_account'});};
  await assert.rejects(f.service.disconnect('acct_fixture'),{code:'DISCONNECT_NOT_SUPPORTED'});
});
test('disabled or disconnecting accounts cannot become checkout-ready even with all provider flags',()=>{
  const account={accountApiVersion:'v2',lifecycleState:'active',mode:'test',stripeAccountId:'acct_fixture',detailsSubmitted:true,
    chargesEnabled:true,cardPaymentsActive:true,controllerMatches:true,synchronizedAt:new Date(),disconnectStatus:'none'};
  assert.equal(paymentsReady(account),true);
  for(const changes of [{paymentsDisabledAt:new Date()},{disconnectStatus:'pending'},{disconnectStatus:'disconnected'},{lifecycleState:'archived'}]) assert.equal(paymentsReady({...account,...changes}),false);
});
