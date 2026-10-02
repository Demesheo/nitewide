const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const request=require('supertest');
const {assertManagedTestDatabase}=require('../scripts/test-database.cjs');
const {createBusinessPaymentAccountService,RESPONSIBILITIES,resolvePaymentAccount}=require('../src/services/business-payment-account-service');
const {createBusinessPaymentDisconnectService}=require('../src/services/business-payment-disconnect-service');
const {mutationTransaction}=require('../src/services/mutation-transaction');
const {createStripeWebhookService}=require('../src/services/stripe-webhook-service');
const {createStripeRefundService}=require('../src/services/stripe-refund-service');
const schemas=require('../src/http/payment-schemas');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const control=()=>({confirmed:true,reason:'Self-service connection change',idempotencyKey:randomUUID()});
async function fixture(run) {
  assertManagedTestDatabase();const config=require('../src/config').getConfig();
  const db=require('../src/db/sequelize').createSequelize(config),m=require('../src/db/models').initModels(db);
  let clock=new Date(),calls=0;
  try {
    const user=async name=>m.User.create({displayName:name,email:`${randomUUID()}@offline.nitewide.test`});
    const owner=await user('Owner'),manager=await user('Manager'),outsider=await user('Outsider');
    await outsider.update({isInternalAdmin:true});
    const org=await m.Organization.create({name:'Disconnect fixture',slug:`disconnect-${randomUUID()}`,onboardingEstablished:true});
    await m.OrganizationOwner.create({organizationId:org.id,userId:owner.id,role:'owner'});
    const membership=await m.OrganizationOwner.create({organizationId:org.id,userId:manager.id,role:'admin',financeAuthorized:true});
    const remote={id:`acct_${randomUUID().replaceAll('-','')}`,object:'v2.core.account',livemode:false,applied_configurations:['merchant'],dashboard:'full',
      defaults:{responsibilities:{...RESPONSIBILITIES,requirements_collector:'stripe'}},configuration:{merchant:{applied:true,
        capabilities:{card_payments:{status:'active'},stripe_balance:{payouts:{status:'active'}}}}},requirements:{entries:[]}};
    const stripe={mode:'test',enabled:true,disconnectEnabled:true,createAccount:async()=>remote,retrieveAccount:async()=>remote,
      disconnectAccount:async()=>{calls++;return {disconnected:true};}};
    const accounts=createBusinessPaymentAccountService({models:m,stripe,now:()=>clock});
    const saved=await accounts.create(owner.id,org.id,{name:'Test merchant',idempotencyKey:randomUUID()});
    await accounts.synchronize(owner.id,org.id,saved.id);await accounts.selectDefault(owner.id,org.id,saved.id);
    await org.reload();const profile=await m.PaymentAccount.findByPk(saved.id);
    const disconnect=createBusinessPaymentDisconnectService({models:m,stripe,paymentAccounts:accounts,now:()=>clock});
    async function event(future=true) {
      const start=+clock+(future?3600000:-7200000);
      return m.Event.create({organizationId:org.id,creatorUserId:owner.id,title:'Fixture event',slug:`event-${randomUUID()}`,status:'published',startsAt:new Date(start),endsAt:new Date(start+3600000)});
    }
    async function order(e,status='paid',changes={}) {
      return m.Order.create({buyerUserId:owner.id,eventId:e.id,status,idempotencyKey:randomUUID(),paymentAccountId:profile.id,stripeAccountId:remote.id,
        providerMode:'test',providerVerificationStatus:'verified',stripePaymentIntentId:`pi_${randomUUID().replaceAll('-','')}`,stripeChargeId:`ch_${randomUUID().replaceAll('-','')}`,totalCents:1000,...changes});
    }
    await run({m,db,config,owner,manager,outsider,membership,org,profile,remote,stripe,accounts,disconnect,event,order,
      calls:()=>calls,tick:()=>{clock=new Date(+clock+61000);}});
  } finally {await db.close();}
}
test('owners explicitly delegate disconnect authority; finance grants and platform admin flags alone cannot disconnect',{timeout:30000},()=>fixture(async f=>{
  const {disconnect,owner,manager,outsider,org,profile,membership,m}=f;
  await assert.rejects(disconnect.impact(manager.id,org.id,profile.id),{code:'FORBIDDEN'});
  await assert.rejects(disconnect.disable(outsider.id,org.id,profile.id,control()),{code:'FORBIDDEN'});
  await assert.rejects(disconnect.grant(manager.id,org.id,manager.id,{paymentDisconnectAuthorized:true,reason:'Manager self grant',version:org.version}),{code:'FORBIDDEN'});
  const grant=await disconnect.grant(owner.id,org.id,manager.id,{paymentDisconnectAuthorized:true,reason:'Owner approved disconnect',version:org.version});
  assert.equal(grant.paymentDisconnectAuthorized,true);assert.equal((await disconnect.impact(manager.id,org.id,profile.id)).canDisconnect,true);
  await assert.rejects(disconnect.grant(owner.id,org.id,manager.id,{paymentDisconnectAuthorized:false,reason:'Stale grant',version:org.version}),{code:'STALE_VERSION'});
  await m.OrganizationOwner.update({financeAuthorized:false},{where:{id:membership.id}});await membership.reload();assert.equal(membership.paymentDisconnectAuthorized,false);
  await m.OrganizationOwner.update({financeAuthorized:true},{where:{id:membership.id}});
  await assert.rejects(disconnect.disable(manager.id,org.id,profile.id,control()),{code:'FORBIDDEN'});
  await m.OrganizationOwner.update({paymentDisconnectAuthorized:true},{where:{id:membership.id}});
  await m.OrganizationOwner.update({lifecycleState:'archived'},{where:{id:membership.id}});
  await m.OrganizationOwner.unscoped().update({lifecycleState:'active'},{where:{id:membership.id}});
  await membership.reload();assert.equal(membership.paymentDisconnectAuthorized,false,'readding does not revive destructive permission');
  assert.equal(f.calls(),0);
}));
test('disabling stops new paid checkout, survives provider refresh and preserves passes; resuming requires verified readiness',{timeout:30000},()=>fixture(async f=>{
  const e=await f.event();await f.m.Offering.create({eventId:e.id,name:'Admission',priceCents:1000,quantityTotal:100});
  const paid=await f.order(e),offering=await f.m.Offering.findOne({where:{eventId:e.id}});
  const item=await f.m.OrderItem.create({orderId:paid.id,offeringId:offering.id,nameSnapshot:'Admission',kindSnapshot:'ticket',quantity:1,entriesPerUnitSnapshot:1});
  const pass=await f.m.Ticket.create({eventId:e.id,orderItemId:item.id,holderUserId:f.owner.id,qrTokenHash:createHash('sha256').update(randomUUID()).digest('hex')});
  const impact=await f.disconnect.impact(f.owner.id,f.org.id,f.profile.id);assert.equal(impact.affectedEvents,1);assert.equal(impact.unfulfilledPaidBookings,1);assert.equal(impact.canDisconnect,false);
  const body=control();const disabled=await f.disconnect.disable(f.owner.id,f.org.id,f.profile.id,body);
  assert.ok(disabled.paymentsDisabledAt);assert.equal(disabled.disconnectStatus,'none');
  f.tick();await f.accounts.synchronizeTrusted(f.remote.id);
  await assert.rejects(resolvePaymentAccount({models:f.m,event:e,refresh:false}),{code:'PAYMENTS_NOT_READY'});
  await pass.reload();assert.equal(pass.status,'valid');await paid.reload();assert.equal(paid.status,'paid');assert.equal(paid.stripeAccountId,f.remote.id);
  await assert.rejects(f.disconnect.disconnect(f.owner.id,f.org.id,f.profile.id,control()),{code:'DISCONNECT_OBLIGATIONS'});assert.equal(f.calls(),0);
  f.tick();const resumed=await f.disconnect.resume(f.owner.id,f.org.id,f.profile.id,control());assert.equal(resumed.paymentsReady,true);assert.equal(resumed.paymentsDisabledAt,null);
  await f.disconnect.disable(f.owner.id,f.org.id,f.profile.id,control());f.remote.configuration.merchant.capabilities.card_payments.status='restricted';f.tick();
  await assert.rejects(f.disconnect.resume(f.owner.id,f.org.id,f.profile.id,control()),{code:'PAYMENTS_NOT_READY'});
}));
test('pending/review payments and refunds block disconnection; successful retries retain merchant history and prohibit new refunds',{timeout:30000},()=>fixture(async f=>{
  const past=await f.event(false),paid=await f.order(past),pending=await f.order(past,'pending',{providerVerificationStatus:'review'});
  const refund=await f.m.Refund.create({orderId:paid.id,paymentAccountId:f.profile.id,stripeAccountId:f.remote.id,amountCents:1000,idempotencyKey:randomUUID(),requestedByUserId:f.owner.id,reason:'Test refund'});
  let impact=await f.disconnect.impact(f.owner.id,f.org.id,f.profile.id);
  assert.equal(impact.pendingPayments,1);assert.equal(impact.reviewPayments,1);assert.equal(impact.unresolvedRefunds,1);assert.equal(impact.blockedReasons.length,3);
  await assert.rejects(f.disconnect.disconnect(f.owner.id,f.org.id,f.profile.id,control()),{code:'DISCONNECT_OBLIGATIONS'});
  await pending.update({status:'cancelled',providerVerificationStatus:'verified'});await refund.update({status:'succeeded'});
  const body=control();const result=await f.disconnect.disconnect(f.owner.id,f.org.id,f.profile.id,body);
  assert.equal(result.account.disconnectStatus,'disconnected');assert.equal(f.calls(),1);assert.equal(result.account.stripeAccountId,f.remote.id);
  assert.equal((await f.disconnect.disconnect(f.owner.id,f.org.id,f.profile.id,body)).retryable,false);assert.equal(f.calls(),1);
  const list=await f.accounts.list(f.owner.id,f.org.id);assert.ok(list.items.some(p=>p.id===f.profile.id && p.disconnectStatus==='disconnected'));
  await paid.reload();assert.equal(paid.paymentAccountId,f.profile.id);assert.equal(paid.status,'paid');
  await assert.rejects(f.accounts.synchronizeTrusted(f.remote.id),{code:'NOT_FOUND'});
  await assert.rejects(f.disconnect.resume(f.owner.id,f.org.id,f.profile.id,control()),{code:'DISCONNECT_PENDING'});
  // Another historical order has no earlier refund. Disconnection must not
  // permit a new asynchronous refund to race external access revocation.
  const another=await f.order(past);
  const refunds=createStripeRefundService({sequelize:f.db,models:f.m,stripe:f.stripe});
  await assert.rejects(refunds.requestRefund(f.owner.id,another.id,{reason:'Late refund',idempotencyKey:randomUUID()}),{code:'PAYMENT_ACCOUNT_DISCONNECTED'});
}));
test('unknown provider result remains disabled and retryable; signed deauthorization finalizes without recreating or deleting accounts',{timeout:30000},()=>fixture(async f=>{
  f.stripe.disconnectAccount=async()=>{throw new Error('lost response with secret details');};const body=control();
  const result=await f.disconnect.disconnect(f.owner.id,f.org.id,f.profile.id,body);
  assert.equal(result.retryable,true);assert.equal(result.account.disconnectErrorCode,'DISCONNECT_UNCONFIRMED');assert.equal(result.account.disconnectStatus,'pending');
  await assert.rejects(f.disconnect.disconnect(f.owner.id,f.org.id,f.profile.id,control()),{code:'DISCONNECT_PENDING'});
  assert.equal((await f.disconnect.disconnect(f.owner.id,f.org.id,f.profile.id,body)).retryable,true);
  f.stripe.constructWebhookEvent=raw=>JSON.parse(raw);
  const webhooks=createStripeWebhookService({sequelize:f.db,models:f.m,stripe:f.stripe,paymentAccounts:f.accounts});
  const event={id:`evt_${randomUUID()}`,livemode:false,account:f.remote.id,type:'account.application.deauthorized',data:{object:{}}};
  await webhooks.receive(Buffer.from(JSON.stringify(event)),'mock-signed');await f.profile.reload();
  assert.equal(f.profile.disconnectStatus,'disconnected');assert.ok(f.profile.disconnectedAt);
  assert.equal((await f.disconnect.disconnect(f.owner.id,f.org.id,f.profile.id,body)).retryable,false);
  assert.equal(JSON.stringify(await f.m.AuditLog.findAll({where:{organizationId:f.org.id}})).includes('secret details'),false);
}));
test('a slow resume cannot undo a newer confirmed disable',{timeout:30000},()=>fixture(async f=>{
  await f.disconnect.disable(f.owner.id,f.org.id,f.profile.id,control());
  const started=deferred(),retrieval=deferred();
  f.stripe.retrieveAccount=async()=>{started.resolve();return retrieval.promise;};f.tick();
  const resuming=f.disconnect.resume(f.owner.id,f.org.id,f.profile.id,control());
  const stale=assert.rejects(resuming,{code:'PAYMENT_ACCOUNT_CHANGED'});
  await started.promise;await f.disconnect.disable(f.owner.id,f.org.id,f.profile.id,control());retrieval.resolve(f.remote);
  await stale;await f.profile.reload();assert.ok(f.profile.paymentsDisabledAt);assert.equal(f.profile.controlVersion,2);
}));
test('disconnect authorization is fenced against concurrent removal and HTTP contracts reject unconfirmed mutations',{timeout:30000},()=>fixture(async f=>{
  await f.disconnect.grant(f.owner.id,f.org.id,f.manager.id,{paymentDisconnectAuthorized:true,reason:'Grant for race',version:f.org.version});
  const started=deferred(),release=deferred();
  const removal=mutationTransaction(f.db,async transaction=>{await f.m.OrganizationOwner.update({lifecycleState:'archived',financeAuthorized:false},{where:{id:f.membership.id},transaction});started.resolve();await release.promise;},{accessChange:true});
  await started.promise;const change=f.disconnect.disable(f.manager.id,f.org.id,f.profile.id,control());const denied=assert.rejects(change,{code:'FORBIDDEN'});
  release.resolve();await removal;await denied;await f.profile.reload();assert.equal(f.profile.paymentsDisabledAt,null);
  const app=require('../src/app').createApp({sequelize:f.db,models:f.m,config:f.config,services:{stripe:f.stripe,paymentAccounts:f.accounts}});
  const path=`/api/business/organizations/${f.org.id}/payment-accounts/${f.profile.id}`;
  const response=await request(app).get(`${path}/disconnect-impact`).set('x-user-id',f.owner.id).expect(200).expect('Cache-Control','no-store');
  schemas.disconnectImpact.parse(response.body.data);
  await request(app).post(`${path}/disable`).set('x-user-id',f.owner.id).send({...control(),confirmed:false}).expect(422);
  await request(app).get(`${path}/disconnect-impact`).set('x-user-id',f.outsider.id).expect(403);
  const disabled=await request(app).post(`${path}/disable`).set('x-user-id',f.owner.id).send(control()).expect(200);
  schemas.paymentAccount.parse(disabled.body.data);
}));
