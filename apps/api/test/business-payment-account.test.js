const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createBusinessPaymentAccountService,resolvePaymentAccount,paymentsReady,providerState,RESPONSIBILITIES } = require('../src/services/business-payment-account-service');
const readyRemote = (id='acct_test')=>({id,object:'v2.core.account',livemode:false,applied_configurations:['merchant'],dashboard:'full',defaults:{responsibilities:{...RESPONSIBILITIES,requirements_collector:'stripe'}},configuration:{merchant:{applied:true,capabilities:{card_payments:{status:'active'},stripe_balance:{payouts:{status:'active'}}}}},requirements:{entries:[]}});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture({role='owner',financeAuthorized=false,active=true,mode='test'}={}) {
  const profiles = new Map(); const calls=[]; const organization = { id:'org',status:'active',defaultPaymentAccountId:null,update:async function(v){Object.assign(this,v);} };
  const transaction = { LOCK:{UPDATE:'UPDATE',SHARE:'SHARE'} };
  const models = { Organization:{sequelize:{transaction:async (_opts,fn)=>fn(transaction)},findByPk:async()=>organization},
    User:{findByPk:async()=>({id:'user',isActive:active})},OrganizationOwner:{findOne:async()=>({role,financeAuthorized})},
    PaymentAccount:{findByPk:async id=>profiles.get(id),findOne:async ({where})=>{const a=where.id?profiles.get(where.id):[...profiles.values()].find(p=>p.stripeAccountId===where.stripeAccountId);return a && (!where.organizationId || a.organizationId===where.organizationId) && (!where.lifecycleState || a.lifecycleState===where.lifecycleState)?a:null;},
      create:async v=>{const a={...v,lifecycleState:'active',disconnectStatus:'none',update:async function(values){Object.assign(this,values);},toJSON:function(){const {update,toJSON,...values}=this;return values;}};profiles.set(a.id,a);return a;},
      count:async()=>profiles.size,findAll:async()=>[...profiles.values()]},Event:{findAll:async()=>[],findByPk:async()=>null},Order:{count:async()=>0} };
  let remote = {...readyRemote(),livemode:mode === 'live'};
  const stripe = {mode,createAccount:async (params,options)=>{calls.push({params,options});return remote;},retrieveAccount:async ()=>remote,createAccountLink:async params=>{calls.push(params);return {object:'v2.core.account_link',account:params.account,livemode:mode === 'live',url:'https://connect.stripe.test/single-use',expires_at:'2033-05-18T03:33:20.000Z'};}};
  return {models,stripe,profiles,calls,organization,service:createBusinessPaymentAccountService({models,stripe,businessAppUrl:'https://business.example/app'}),setRemote:r=>remote=r};
}
test('named profile persists before provider creation and stable retries reuse controller account',async()=>{
  const f=fixture();const id=randomUUID();const a=await f.service.create('user','org',{name:'Nightclub A',idempotencyKey:id});
  assert.equal(a.id,id);assert.equal(a.paymentsReady,false);assert.equal(f.calls[0].params.dashboard,'full');assert.equal(f.calls[0].params.controller,undefined);assert.equal(f.calls[0].params.type,undefined);
  assert.deepEqual(f.calls[0].params.configuration,{merchant:{capabilities:{card_payments:{requested:true}}}});assert.deepEqual(f.calls[0].params.defaults.responsibilities,RESPONSIBILITIES);
  await f.service.create('user','org',{name:'Nightclub A',idempotencyKey:id});assert.equal(f.calls.length,1);
  await assert.rejects(f.service.create('user','org',{name:'Different merchant',idempotencyKey:id}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('only active owners and explicitly finance-authorized managers can manage profiles',async()=>{
  for(const options of [{role:'admin'},{role:'employee'},{active:false}]){const f=fixture(options);await assert.rejects(f.service.list('user','org'),{code:'FORBIDDEN'});assert.equal(f.calls.length,0);}
  await assert.doesNotReject(fixture({role:'admin',financeAuthorized:true}).service.list('user','org'));
});
test('hosted onboarding returns one-time URL but never grants readiness',async()=>{
  const f=fixture();const a=await f.service.create('user','org',{name:'Nightclub',idempotencyKey:randomUUID()});
  const link=await f.service.onboarding('user','org',a.id);assert.match(link.url,/single-use/);assert.equal(f.profiles.get(a.id).chargesEnabled,undefined);
  const params=f.calls[1];assert.equal(params.use_case.type,'account_onboarding');assert.deepEqual(params.use_case.account_onboarding.configurations,['merchant']);
  const returned=new URL(params.use_case.account_onboarding.return_url);
  assert.equal(returned.searchParams.get('section'),'payments');assert.equal(returned.searchParams.get('paymentOrganization'),'org');
  assert.equal(returned.searchParams.get('paymentAccountReturn'),a.id);assert.equal(returned.searchParams.has('teamOrganizationId'),false);
});
test('provider synchronization and exact scoped profile enable sandbox readiness',async()=>{
  const f=fixture();const a=await f.service.create('user','org',{name:'Nightclub',idempotencyKey:randomUUID()});await f.service.synchronize('user','org',a.id);
  f.organization.defaultPaymentAccountId=a.id;
  const account=await resolvePaymentAccount({models:f.models,event:{organizationId:'org'},stripe:f.stripe,refresh:false});assert.equal(paymentsReady(account),true);
  await assert.rejects(resolvePaymentAccount({models:f.models,event:{organizationId:'other',paymentAccountId:a.id},stripe:f.stripe,refresh:false}),{code:'PAYMENTS_NOT_READY'});
  account.synchronizedAt=new Date(Date.now()-300001);assert.equal(paymentsReady(account),false);
  await assert.rejects(resolvePaymentAccount({models:f.models,event:{organizationId:'org'},stripe:f.stripe,refresh:false}),{code:'PAYMENTS_NOT_READY'});
});
test('live merchant onboarding and cached publication require the current provider mode',async()=>{
  const f=fixture({mode:'live'}),id=randomUUID();
  const created=await f.service.create('user','org',{name:'Live merchant',idempotencyKey:id});
  assert.equal(created.mode,'live');assert.equal(created.paymentsReady,false);
  await f.service.onboarding('user','org',id);
  const verified=await f.service.synchronize('user','org',id);assert.equal(verified.paymentsReady,true);
  f.organization.defaultPaymentAccountId=id;
  const selected=await resolvePaymentAccount({models:f.models,event:{organizationId:'org'},stripe:f.stripe,refresh:false});
  assert.equal(paymentsReady(selected,new Date(),'live'),true);
  assert.equal(paymentsReady(selected,new Date(),'test'),false);
  assert.equal(paymentsReady(selected,new Date(),'disabled'),false);
  let providerCalls=0;const testStripe={...f.stripe,mode:'test',retrieveAccount:async()=>{providerCalls++;throw new Error('Wrong mode must not query Stripe');}};
  const other=createBusinessPaymentAccountService({models:f.models,stripe:testStripe});
  await assert.rejects(resolvePaymentAccount({models:f.models,event:{organizationId:'org'},stripe:testStripe}),{code:'PAYMENTS_NOT_READY'});
  await assert.rejects(other.synchronize('user','org',id),{code:'PAYMENTS_NOT_READY'});
  await assert.rejects(other.synchronizeTrusted(selected.stripeAccountId),{code:'NOT_FOUND'});
  await assert.rejects(other.onboarding('user','org',id),{code:'PAYMENTS_NOT_READY'});
  await assert.rejects(other.create('user','org',{name:'Live merchant',idempotencyKey:id}),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(other.selectDefault('user','org',id),{code:'PAYMENTS_NOT_READY'});
  assert.equal((await other.list('user','org')).items[0].paymentsReady,false);assert.equal(providerCalls,0);
  f.setRemote({...readyRemote(),livemode:false});
  assert.equal((await f.service.synchronize('user','org',id)).paymentsReady,false);
});
test('live/controller/capability mismatch cannot become provider-confirmed readiness',async()=>{
  const f=fixture();const a=await f.service.create('user','org',{name:'Nightclub',idempotencyKey:randomUUID()});
  f.setRemote({...readyRemote(),livemode:true});
  const refreshed=await f.service.synchronize('user','org',a.id);assert.equal(refreshed.paymentsReady,false);assert.equal(refreshed.chargesEnabled,false);
});
test('v2 include omissions, v1 flags, due requirements and closed accounts fail closed',()=>{
  for(const remote of [
    {id:'acct_test',charges_enabled:true,details_submitted:true,capabilities:{card_payments:'active'}},
    {...readyRemote(),defaults:null}, {...readyRemote(),configuration:null}, {...readyRemote(),configuration:{merchant:{capabilities:{card_payments:{status:'active'}}}}}, {...readyRemote(),requirements:null},
    {...readyRemote(),requirements:{entries:[{description:'identity.document',awaiting_action_from:'user',minimum_deadline:{status:'currently_due'}}]}},
    {...readyRemote(),closed:true},
  ]){const state=providerState(remote,'acct_test');assert.equal(paymentsReady({id:'profile',stripeAccountId:'acct_test',mode:'test',lifecycleState:'active',...state}),false);}
});
test('trusted v2 closed-account synchronization archives access and never reactivates it',async()=>{
  const f=fixture();const a=await f.service.create('user','org',{name:'Nightclub',idempotencyKey:randomUUID()});
  f.setRemote({...readyRemote(),closed:true});await f.service.synchronizeTrusted('acct_test');
  assert.equal(f.profiles.get(a.id).lifecycleState,'archived');assert.equal(paymentsReady(f.profiles.get(a.id)),false);
  f.setRemote(readyRemote());await assert.rejects(f.service.synchronizeTrusted('acct_test'),{code:'NOT_FOUND'});
});
test('late ready response cannot overwrite newer revoked provider observation',async()=>{
  const f=fixture();const a=await f.service.create('user','org',{name:'Nightclub',idempotencyKey:randomUUID()});
  let clock=new Date(Date.now()-2000);const first=deferred(),started=deferred();let calls=0,transactions=0;
  const originalTransaction=f.models.Organization.sequelize.transaction;
  f.models.Organization.sequelize.transaction=async(opts,fn)=>originalTransaction(opts,async tx=>{transactions++;try{return await fn(tx);}finally{transactions--;}});
  const revoked=readyRemote();revoked.configuration.merchant.capabilities.card_payments.status='restricted';
  f.stripe.retrieveAccount=async()=>{assert.equal(transactions,0,'provider retrieval occurs outside locks');if(++calls===1){started.resolve();return first.promise;}return revoked;};
  const service=createBusinessPaymentAccountService({models:f.models,stripe:f.stripe,now:()=>clock});
  const older=service.synchronize('user','org',a.id);await started.promise;
  clock=new Date(+clock+1000);await service.synchronizeTrusted('acct_test');
  const newerObservation=+f.profiles.get(a.id).synchronizedAt;
  first.resolve(readyRemote());await older;
  assert.equal(f.profiles.get(a.id).chargesEnabled,false);assert.equal(+f.profiles.get(a.id).synchronizedAt,newerObservation);
});
test('checkout refresh also rejects an old response after a newer revocation',async()=>{
  const f=fixture();const a=await f.service.create('user','org',{name:'Nightclub',idempotencyKey:randomUUID()});f.organization.defaultPaymentAccountId=a.id;
  let clock=new Date(Date.now()-2000);const first=deferred(),started=deferred();let calls=0;
  const revoked=readyRemote();revoked.configuration.merchant.capabilities.card_payments.status='restricted';
  f.stripe.retrieveAccount=async()=>{if(++calls===1){started.resolve();return first.promise;}return revoked;};
  const refresh=resolvePaymentAccount({models:f.models,event:{organizationId:'org'},stripe:f.stripe,now:()=>clock});
  const rejected=assert.rejects(refresh,{code:'PAYMENTS_NOT_READY'});await started.promise;
  clock=new Date(+clock+1000);await createBusinessPaymentAccountService({models:f.models,stripe:f.stripe,now:()=>clock}).synchronizeTrusted('acct_test');
  first.resolve(readyRemote());await rejected;assert.equal(f.profiles.get(a.id).chargesEnabled,false);
});
test('same observation time cannot re-enable readiness after revocation',async()=>{
  const f=fixture();const a=await f.service.create('user','org',{name:'Nightclub',idempotencyKey:randomUUID()});const clock=new Date(Date.now()-1000);
  const service=createBusinessPaymentAccountService({models:f.models,stripe:f.stripe,now:()=>clock});
  const revoked=readyRemote();revoked.configuration.merchant.capabilities.card_payments.status='restricted';f.setRemote(revoked);await service.synchronizeTrusted('acct_test');
  f.setRemote(readyRemote());await service.synchronizeTrusted('acct_test');assert.equal(f.profiles.get(a.id).chargesEnabled,false);assert.equal(+f.profiles.get(a.id).synchronizedAt,+clock);
});
test('slow provider retrieval cannot extend freshness beyond observation start',async()=>{
  const f=fixture();const a=await f.service.create('user','org',{name:'Nightclub',idempotencyKey:randomUUID()});f.organization.defaultPaymentAccountId=a.id;
  let clock=new Date();const response=deferred(),started=deferred();f.stripe.retrieveAccount=async()=>{started.resolve();return response.promise;};
  const pending=resolvePaymentAccount({models:f.models,event:{organizationId:'org'},stripe:f.stripe,now:()=>clock});const rejection=assert.rejects(pending,{code:'PAYMENTS_NOT_READY'});
  await started.promise;const observedAt=+clock;clock=new Date(observedAt+300001);response.resolve(readyRemote());await rejection;
  assert.equal(+f.profiles.get(a.id).synchronizedAt,observedAt);
});

test('default selection ignores ended demo events and does not require their old paid offerings to be Stripe ready',async()=>{
  const f=fixture(); const a=await f.service.create('user','org',{name:'New merchant',idempotencyKey:randomUUID()});
  f.models.Event.findAll=async()=>[{id:'ended',organizationId:'org',status:'published',endsAt:new Date(Date.now()-1000)}];
  f.models.Offering={findAll:async()=>{throw new Error('Ended events must not be revalidated for paid publication');}};
  assert.deepEqual(await f.service.selectDefault('user','org',a.id),{defaultPaymentAccountId:a.id});
  assert.equal(f.organization.defaultPaymentAccountId,a.id);
});
test('an unresolved inherited Stripe checkout prevents default selection under the authorization transaction',async()=>{
  const f=fixture(); const a=await f.service.create('user','org',{name:'New merchant',idempotencyKey:randomUUID()});
  f.models.Event.findAll=async()=>[{id:'pending',status:'draft'}];
  f.models.Order.count=async options=>{assert.ok(options.transaction);return 1;};
  await assert.rejects(f.service.selectDefault('user','org',a.id),{code:'PAYMENT_ACCOUNT_LOCKED'});
  assert.equal(f.organization.defaultPaymentAccountId,null);
});
test('reselecting the current default is a harmless no-op even while activity is pending',async()=>{
  const f=fixture(); const a=await f.service.create('user','org',{name:'Current merchant',idempotencyKey:randomUUID()});
  f.organization.defaultPaymentAccountId=a.id;
  f.models.Event.findAll=async()=>{throw new Error('A no-op should not load or mutate events');};
  assert.deepEqual(await f.service.selectDefault('user','org',a.id),{defaultPaymentAccountId:a.id});
});
