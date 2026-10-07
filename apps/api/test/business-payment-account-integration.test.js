const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {assertManagedTestDatabase}=require('../scripts/test-database.cjs');
const {createBusinessPaymentAccountService,RESPONSIBILITIES,resolvePaymentAccount}=require('../src/services/business-payment-account-service');
const {createBusinessPaymentOverviewService}=require('../src/services/business-payment-overview-service');
const {createBusinessReadService}=require('../src/services/business-read-service');
const {createApp}=require('../src/app');
const request=require('supertest');
const paymentSchemas=require('../src/http/payment-schemas');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const {mutationTransaction}=require('../src/services/mutation-transaction');
const {request:httpRequest}=require('./support/http-client.cjs');
const {createBusinessService}=require('../src/services/business-service');
const {createPermissionService}=require('../src/services/permission-service');
const {eventEditor}=require('../src/http/business-schemas');

test('paid event editor refreshes only its authorized merchant outside locks and rechecks the final mutation',{timeout:60000},async t=>{
  assertManagedTestDatabase();
  const config=require('../src/config').getConfig(),db=require('../src/db/sequelize').createSequelize(config);
  const m=require('../src/db/models').initModels(db);
  const remote=id=>({id,object:'v2.core.account',livemode:false,applied_configurations:['merchant'],dashboard:'full',
    defaults:{responsibilities:{...RESPONSIBILITIES,requirements_collector:'stripe'}},
    configuration:{merchant:{applied:true,capabilities:{card_payments:{status:'active'},stripe_balance:{payouts:{status:'active'}}}}},requirements:{entries:[]}});
  const calls=[];
  let provider=id=>remote(id),transactions=0;
  const originalTransaction=db.transaction.bind(db);
  db.transaction=(options,work)=>originalTransaction(options,async transaction=>{
    transactions++;
    try{return await work(transaction);}finally{transactions--;}
  });
  const stripe={enabled:true,mode:'test',retrieveAccount:async id=>{
    assert.equal(transactions,0,'provider retrieval runs without event transactions or authorization fences');
    calls.push(id);return provider(id);
  }};
  try {
    const users=await m.User.bulkCreate(['Owner','Manager','Venue Manager','Employee','Promoter','Stranger'].map(displayName=>({displayName,email:`${randomUUID()}@offline.nitewide.test`})),{returning:true});
    const [owner,manager,venueManager,employee,promoter,stranger]=users;
    const org=await m.Organization.create({name:'Readiness editor business',slug:randomUUID(),onboardingEstablished:true});
    const foreignOrg=await m.Organization.create({name:'Other readiness business',slug:randomUUID(),onboardingEstablished:true});
    await m.OrganizationOwner.bulkCreate([{organizationId:org.id,userId:owner.id,role:'owner'},
      {organizationId:org.id,userId:manager.id,role:'admin',financeAuthorized:false},
      {organizationId:foreignOrg.id,userId:stranger.id,role:'owner'}]);
    await m.OrganizationEmployee.create({organizationId:org.id,userId:employee.id,status:'active'});
    await m.OrgAffiliate.create({organizationId:org.id,userId:promoter.id,code:`readiness-${randomUUID()}`,status:'active'});
    const location=await m.Location.create({name:'Editor venue',city:'Orlando',countryCode:'US',timezone:'America/New_York',privacy:'public'});
    await m.OrganizationVenue.create({organizationId:org.id,locationId:location.id});
    const venueAccess=await m.VenueAccess.create({organizationId:org.id,locationId:location.id,userId:venueManager.id,role:'manager',status:'active'});
    const account=async(organizationId=org.id)=>m.PaymentAccount.create({organizationId,name:'Editor merchant',stripeAccountId:`acct_${randomUUID().replaceAll('-','')}`,
      detailsSubmitted:true,chargesEnabled:true,cardPaymentsActive:true,controllerMatches:true,synchronizedAt:new Date(Date.now()-600000)});
    const defaultAccount=await account(),overrideAccount=await account(),foreignAccount=await account(foreignOrg.id);
    await org.update({defaultPaymentAccountId:defaultAccount.id});
    const app=createApp({sequelize:db,models:m,config,services:{stripe,email:{enabled:false}}});
    const permissions=createPermissionService(m);
    const accounts=createBusinessPaymentAccountService({models:m,stripe});
    const makeEvent=async(values={})=>m.Event.create({organizationId:org.id,creatorUserId:owner.id,locationId:location.id,
      title:'Unsaved readiness event',slug:`readiness-${randomUUID()}`,status:'draft',startsAt:new Date(Date.now()+86400000),endsAt:new Date(Date.now()+172800000),...values});
    const payload=(event,values={})=>({organizationId:org.id,locationId:location.id,version:event?.version,title:'Saved readiness event',summary:'Editor test',description:'',
      startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+172800000).toISOString(),status:'published',isDiscoverable:false,
      capacity:100,guestlistCapacity:10,offerings:[{name:'Paid ticket',kind:'ticket',priceCents:2000,inventoryMode:'finite',quantityTotal:20,entriesPerUnit:1,minPerOrder:1,maxPerOrder:5,isActive:true}],...values});
    const save=(event,body=payload(event),user=manager.id)=>httpRequest(app,event ? `/api/business/events/${event.id}` : '/api/business/events',{
      method:event?'PUT':'POST',headers:{'x-user-id':user},body,
    });
    const snapshot=async event=>({event:(await event.reload()).toJSON(),offerings:(await m.Offering.findAll({where:{eventId:event.id},order:[['id','ASC']]})).map(row=>row.toJSON()),
      audits:await m.AuditLog.count({where:{entityId:event.id}}),locations:await m.Location.count()});
    await t.test('expired default readiness refreshes on publication and managers gain no finance powers',async()=>{
      const event=await makeEvent();
      await assert.rejects(resolvePaymentAccount({models:m,event,stripe,refresh:false}),{code:'PAYMENTS_NOT_READY'});
      const before=calls.length,response=await save(event).expect(200);
      assert.equal(response.body.data.status,'published');assert.deepEqual(calls.slice(before),[defaultAccount.stripeAccountId]);
      assert.equal((await event.reload()).paymentAccountId,null);assert.equal(await m.Offering.count({where:{eventId:event.id}}),1);
      await assert.rejects(accounts.list(manager.id,org.id),{code:'FORBIDDEN'});
      await assert.rejects(accounts.selectDefault(manager.id,org.id,overrideAccount.id),{code:'FORBIDDEN'});
      assert.equal((await m.OrganizationOwner.findOne({where:{organizationId:org.id,userId:manager.id}})).financeAuthorized,false);
      const tier=await m.Offering.findOne({where:{eventId:event.id}}),next=payload(event);next.offerings[0].id=tier.id;
      await defaultAccount.update({synchronizedAt:new Date(Date.now()-600000)});
      const updated=await save(event,next).expect(200);assert.equal(updated.body.data.status,'published');
    });
    await t.test('new event and event override preserve selected merchant routing',async()=>{
      let before=calls.length;
      const created=await save(null).expect(201);assert.equal(created.body.data.paymentAccountId,null);
      assert.deepEqual(calls.slice(before),[defaultAccount.stripeAccountId]);
      const event=await makeEvent({paymentAccountId:overrideAccount.id});before=calls.length;
      await save(event).expect(200);assert.deepEqual(calls.slice(before),[overrideAccount.stripeAccountId]);
      assert.equal((await event.reload()).paymentAccountId,overrideAccount.id);
    });
    await t.test('exact venue managers can publish without organization or finance permissions',async()=>{
      const event=await makeEvent();await save(event,payload(event),venueManager.id).expect(200);
      await assert.rejects(accounts.list(venueManager.id,org.id),{code:'FORBIDDEN'});
      assert.equal(await m.OrganizationOwner.count({where:{organizationId:org.id,userId:venueManager.id}}),0);
    });
    await t.test('shared sandbox routing refreshes only the canonical merchant',async()=>{
      const sharedStripe={...stripe,sandboxSharedAccountId:foreignAccount.stripeAccountId};
      const service=createBusinessService({models:m,permissions,stripe:sharedStripe,environment:'production'});
      const event=await makeEvent({paymentAccountId:overrideAccount.id}),before=calls.length;
      await service.saveEvent(manager.id,event.id,eventEditor.parse(payload(event)));
      assert.deepEqual(calls.slice(before),[foreignAccount.stripeAccountId]);assert.equal((await event.reload()).paymentAccountId,overrideAccount.id);
      assert.equal((await org.reload()).defaultPaymentAccountId,defaultAccount.id);
    });
    await t.test('drafts, free replacement tiers and inactive paid tiers make no provider request',async()=>{
      for(const values of [{status:'draft'},{offerings:[]},{offerings:[{...payload().offerings[0],priceCents:0}]},
        {offerings:[{...payload().offerings[0],isActive:false}]}]) {
        const event=await makeEvent(),before=calls.length;await save(event,payload(event,values)).expect(200);assert.equal(calls.length,before);
      }
    });
    await t.test('authorization, stale versions, lifecycle, scope and unavailable merchant fail before provider requests',async()=>{
      const event=await makeEvent(),before=await snapshot(event),count=calls.length;
      for(const user of [employee.id,promoter.id,stranger.id])await save(event,payload(event),user).expect(403);
      await save(event,payload(event,{version:event.version+1})).expect(409);
      await event.update({lifecycleState:'suspended'});await save(event,payload(event)).expect(403);await event.update({lifecycleState:'active'});
      await event.update({paymentAccountId:foreignAccount.id});await save(event,payload(event)).expect(409);await event.update({paymentAccountId:null});
      await org.update({defaultPaymentAccountId:null});await save(event,payload(event)).expect(409);await org.update({defaultPaymentAccountId:defaultAccount.id});
      assert.equal(calls.length,count);assert.equal((await snapshot(event)).audits,before.audits);assert.equal(await m.Offering.count({where:{eventId:event.id}}),0);
      for(const state of [{paymentsDisabledAt:new Date()},{disconnectStatus:'pending',paymentsDisabledAt:new Date()},
        {disconnectStatus:'disconnected',paymentsDisabledAt:new Date()},{lifecycleState:'archived'}]) {
        const original={paymentsDisabledAt:null,disconnectStatus:'none',lifecycleState:'active'};
        await defaultAccount.update(state);await save(event,payload(event)).expect(409);await defaultAccount.update(original);
      }
      assert.equal(calls.length,count);
    });
    await t.test('restricted provider readiness and provider failures retain the complete unsaved event',async()=>{
      const event=await makeEvent(),before=await snapshot(event);
      provider=id=>{const value=remote(id);value.configuration.merchant.capabilities.card_payments.status='restricted';return value;};
      let response=await save(event).expect(409);assert.equal(response.body.error.code,'PAYMENTS_NOT_READY');
      assert.match(response.body.error.message,/check your email.*try saving again here/);assert.deepEqual(await snapshot(event),before);
      provider=()=>{throw new Error('sk_test_private_provider_error acct_private_api_response');};
      response=await save(event).expect(503);assert.equal(response.body.error.code,'PAYMENTS_REFRESH_FAILED');
      assert.match(response.body.error.message,/Try saving again from this editor/);assert.equal(JSON.stringify(response.body).includes('private'),false);
      assert.deepEqual(await snapshot(event),before);
      provider=id=>remote(id);await save(event).expect(200);
    });
    async function pausedSave(event,change,{expectedCode='PAYMENTS_NOT_READY',user=manager.id,body=payload(event)}={}) {
      const started=deferred(),release=deferred();provider=async id=>{started.resolve();await release.promise;return remote(id);};
      const attempt=save(event,body,user).then(response=>response);
      await started.promise;
      try{await change();}finally{release.resolve();}
      const response=await attempt;assert.equal(response.body.error.code,expectedCode);provider=id=>remote(id);return response;
    }
    await t.test('revoked actor and exact venue permissions are rechecked after the provider wait',async()=>{
      const event=await makeEvent(),before=await snapshot(event);
      const membership=await m.OrganizationOwner.findOne({where:{organizationId:org.id,userId:manager.id}});
      await pausedSave(event,()=>mutationTransaction(db,transaction=>membership.update({lifecycleState:'suspended'},{transaction}),{accessChange:true}),{expectedCode:'BUSINESS_ACCESS_REQUIRED'});
      assert.deepEqual(await snapshot(event),before);await membership.update({lifecycleState:'active'});
      await pausedSave(event,()=>mutationTransaction(db,transaction=>venueAccess.update({status:'inactive'},{transaction}),{accessChange:true}),{expectedCode:'BUSINESS_ACCESS_REQUIRED',user:venueManager.id});
      assert.deepEqual(await snapshot(event),before);await venueAccess.update({status:'active'});
    });
    await t.test('event version and lifecycle changes during provider retrieval cannot be overwritten',async()=>{
      const event=await makeEvent();
      await pausedSave(event,()=>mutationTransaction(db,transaction=>event.update({title:'Concurrent event edit'},{transaction})),{expectedCode:'CONFLICT'});
      assert.equal((await event.reload()).title,'Concurrent event edit');assert.equal(event.status,'draft');assert.equal(await m.AuditLog.count({where:{entityId:event.id}}),0);
      await pausedSave(event,()=>mutationTransaction(db,transaction=>event.update({lifecycleState:'suspended'},{transaction}),{accessChange:true}),{expectedCode:'FORBIDDEN'});
      assert.equal(await m.Offering.count({where:{eventId:event.id}}),0);
    });
    await t.test('local disable and disconnection during refresh remain enforced without restoring flags',async()=>{
      for(const state of [{paymentsDisabledAt:new Date()},{disconnectStatus:'pending',paymentsDisabledAt:new Date()}]) {
        const event=await makeEvent(),before=await snapshot(event);
        await pausedSave(event,()=>mutationTransaction(db,transaction=>defaultAccount.update(state,{transaction}),{accessChange:true}));
        assert.deepEqual(await snapshot(event),before);await defaultAccount.reload();assert.ok(defaultAccount.paymentsDisabledAt);
        if(state.disconnectStatus)assert.equal(defaultAccount.disconnectStatus,state.disconnectStatus);
        await defaultAccount.update({paymentsDisabledAt:null,disconnectStatus:'none'});
      }
    });
    await t.test('default and override merchant changes fail closed even if the replacement was already ready',async()=>{
      await overrideAccount.update({synchronizedAt:new Date()});
      let event=await makeEvent(),before=await snapshot(event);
      await pausedSave(event,()=>accounts.selectDefault(owner.id,org.id,overrideAccount.id),{expectedCode:'PAYMENT_ACCOUNT_CHANGED'});
      assert.deepEqual(await snapshot(event),before);await org.reload();await org.update({defaultPaymentAccountId:defaultAccount.id});
      event=await makeEvent({paymentAccountId:defaultAccount.id});
      await pausedSave(event,()=>accounts.selectEvent(owner.id,event.id,overrideAccount.id),{expectedCode:'CONFLICT'});
      assert.equal((await event.reload()).paymentAccountId,overrideAccount.id);assert.equal(event.status,'draft');assert.equal(await m.Offering.count({where:{eventId:event.id}}),0);
    });
    await t.test('refresh observation stays bounded by five minutes and cannot extend stale readiness',async()=>{
      const event=await makeEvent();let clock=new Date(),observed=+clock;
      provider=id=>{clock=new Date(observed+300001);return remote(id);};
      const service=createBusinessService({models:m,permissions,stripe,environment:'production',now:()=>clock});
      await assert.rejects(service.saveEvent(manager.id,event.id,eventEditor.parse(payload(event))),{code:'PAYMENTS_NOT_READY'});
      assert.equal(+(await defaultAccount.reload()).synchronizedAt,observed);assert.equal((await event.reload()).status,'draft');
      assert.equal(await m.Offering.count({where:{eventId:event.id}}),0);
    });
  } finally {await db.close();}
});
test('sandbox profiles persist scoped provider readiness and lock event merchant while checkout is unresolved',{timeout:30000},async()=>{
  assertManagedTestDatabase();
  const db=require('../src/db/sequelize').createSequelize(require('../src/config').getConfig());
  const m=require('../src/db/models').initModels(db);
  let providerCalls=0;const remote={id:`acct_${randomUUID().replaceAll('-','')}`,object:'v2.core.account',livemode:false,applied_configurations:['merchant'],dashboard:'full',defaults:{responsibilities:{...RESPONSIBILITIES,requirements_collector:'stripe'}},configuration:{merchant:{applied:true,capabilities:{card_payments:{status:'active'},stripe_balance:{payouts:{status:'active'}}}}},requirements:{entries:[]}};
  let onboardingInput;
  const stripe={mode:'test',enabled:true,createAccount:async()=>{providerCalls++;return remote;},retrieveAccount:async()=>remote,createAccountLink:async input=>{onboardingInput=input;return {object:'v2.core.account_link',account:remote.id,livemode:false,url:'https://connect.stripe.test/mock-only',expires_at:'2033-05-18T03:33:20.000Z'};}};
  try {
    const owner=await m.User.create({displayName:'Sandbox Owner',email:`owner-${randomUUID()}@example.test`});
    const other=await m.User.create({displayName:'Unrelated Owner',email:`other-${randomUUID()}@example.test`});
    const org=await m.Organization.create({name:'Sandbox nightclub',slug:`sandbox-${randomUUID()}`,onboardingEstablished:true});
    const org2=await m.Organization.create({name:'Other business',slug:`other-${randomUUID()}`,onboardingEstablished:true});
    await m.OrganizationOwner.create({organizationId:org.id,userId:owner.id,role:'owner'});
    await m.OrganizationOwner.create({organizationId:org2.id,userId:other.id,role:'owner'});
    const service=createBusinessPaymentAccountService({models:m,stripe,businessAppUrl:'https://business.example/app'});
    const input={name:'Club A merchant',idempotencyKey:randomUUID()};const profile=await service.create(owner.id,org.id,input);
    await service.create(owner.id,org.id,input);assert.equal(providerCalls,1);
    await assert.rejects(service.list(other.id,org.id),{code:'FORBIDDEN'});
    await assert.rejects(service.onboarding(other.id,org2.id,profile.id),{code:'NOT_FOUND'});
    const before=await m.PaymentAccount.findByPk(profile.id);assert.equal(before.chargesEnabled,false);
    await service.onboarding(owner.id,org.id,profile.id);await before.reload();assert.equal(before.chargesEnabled,false);
    const returned=new URL(onboardingInput.use_case.account_onboarding.return_url);
    assert.equal(returned.searchParams.get('section'),'payments');assert.equal(returned.searchParams.get('paymentOrganization'),org.id);
    assert.equal(returned.searchParams.get('paymentAccountReturn'),profile.id);assert.equal(returned.searchParams.has('teamOrganizationId'),false);
    assert.equal(onboardingInput.use_case.account_onboarding.refresh_url,returned.toString());
    const synchronized=await service.synchronize(owner.id,org.id,profile.id);assert.equal(synchronized.paymentsReady,true);
    await service.selectDefault(owner.id,org.id,profile.id);
    const event=await m.Event.create({creatorUserId:owner.id,organizationId:org.id,title:'Sandbox Event',slug:`event-${randomUUID()}`,startsAt:new Date(Date.now()+3600000),endsAt:new Date(Date.now()+7200000)});
    assert.equal((await resolvePaymentAccount({models:m,event,refresh:false})).id,profile.id);
    await service.selectEvent(owner.id,event.id,profile.id);
    await m.Order.create({buyerUserId:owner.id,eventId:event.id,status:'pending',idempotencyKey:randomUUID(),paymentAccountId:profile.id,stripeAccountId:remote.id,providerMode:'test'});
    await assert.rejects(service.selectEvent(owner.id,event.id,null),{code:'PAYMENT_ACCOUNT_LOCKED'});
    remote.configuration.merchant.capabilities.card_payments.status='restricted';await service.synchronize(owner.id,org.id,profile.id);
    await assert.rejects(resolvePaymentAccount({models:m,event,refresh:false}),{code:'PAYMENTS_NOT_READY'});
    const audit=await m.AuditLog.findAll({where:{organizationId:org.id}});assert.ok(audit.length>=3);assert.equal(JSON.stringify(audit).includes('mock-only'),false);
    const cached=await m.PaymentAccount.findByPk(profile.id);let clock=new Date(+cached.synchronizedAt+1000);
    const slow=deferred(),started=deferred();let retrievals=0;
    const revoked=structuredClone(remote),ready=structuredClone(remote);ready.configuration.merchant.capabilities.card_payments.status='active';
    stripe.retrieveAccount=async()=>{if(++retrievals===1){started.resolve();return slow.promise;}return revoked;};
    const ordered=createBusinessPaymentAccountService({models:m,stripe,now:()=>clock});
    const older=ordered.synchronize(owner.id,org.id,profile.id);await started.promise;
    clock=new Date(+clock+1000);await ordered.synchronizeTrusted(remote.id);
    slow.resolve(ready);await older;await cached.reload();
    assert.equal(cached.chargesEnabled,false);assert.equal(+cached.synchronizedAt,+clock,'freshness remains anchored to newer request observation');
    const closing=deferred(),closingStarted=deferred();retrievals=0;
    stripe.retrieveAccount=async()=>{if(++retrievals===1){closingStarted.resolve();return closing.promise;}return {...ready,closed:true};};
    clock=new Date(+clock+1000);const beforeClose=ordered.synchronize(owner.id,org.id,profile.id);const closedRejection=assert.rejects(beforeClose,{code:'NOT_FOUND'});await closingStarted.promise;
    clock=new Date(+clock+1000);await ordered.synchronizeTrusted(remote.id);
    closing.resolve(ready);await closedRejection;await cached.reload();assert.equal(cached.lifecycleState,'archived');assert.equal(cached.chargesEnabled,false);
  } finally {await db.close();}
});

test('settled activity unlocks merchant selection without moving old orders, payments or refunds',{timeout:60000},async t=>{
  assertManagedTestDatabase();
  const config=require('../src/config').getConfig(),db=require('../src/db/sequelize').createSequelize(config);
  const m=require('../src/db/models').initModels(db);
  try {
    const owner=await m.User.create({displayName:'Merchant selection owner',email:`${randomUUID()}@offline.nitewide.test`});
    const stranger=await m.User.create({displayName:'Other business owner',email:`${randomUUID()}@offline.nitewide.test`});
    const org=await m.Organization.create({name:'Past demo venue',slug:randomUUID(),onboardingEstablished:true});
    const foreignOrg=await m.Organization.create({name:'Other venue',slug:randomUUID(),onboardingEstablished:true});
    await m.OrganizationOwner.create({organizationId:org.id,userId:owner.id,role:'owner'});
    const old=await m.PaymentAccount.create({organizationId:org.id,name:'Original',stripeAccountId:`acct_${randomUUID().replaceAll('-','')}`});
    const fresh=await m.PaymentAccount.create({organizationId:org.id,name:'New',stripeAccountId:`acct_${randomUUID().replaceAll('-','')}`});
    const foreign=await m.PaymentAccount.create({organizationId:foreignOrg.id,name:'Foreign',stripeAccountId:`acct_${randomUUID().replaceAll('-','')}`});
    const ended=await m.Event.create({organizationId:org.id,creatorUserId:owner.id,title:'Ended venue night',slug:randomUUID(),status:'published',
      startsAt:new Date(Date.now()-7200000),endsAt:new Date(Date.now()-3600000)});
    await m.Offering.create({eventId:ended.id,name:'Historical ticket',priceCents:2000,quantityTotal:100});
    const demo=await m.Order.create({buyerUserId:owner.id,eventId:ended.id,status:'paid',idempotencyKey:randomUUID(),pricingPlanSnapshot:{demo:true}});
    const beforeDemo=demo.toJSON();
    const stripe={mode:'test',enabled:true};
    const accounts=createBusinessPaymentAccountService({models:m,stripe});
    const app=createApp({sequelize:db,models:m,config,services:{stripe,email:{enabled:false}}});
    const selectDefault=(id,userId=owner.id)=>request(app).put(`/api/business/organizations/${org.id}/payment-accounts/default`).set('x-user-id',userId).send({paymentAccountId:id});
    const selectEvent=id=>request(app).put(`/api/business/events/${ended.id}/payment-account`).set('x-user-id',owner.id).send({paymentAccountId:id});
    const editable=async()=>{const res=await request(app).get(`/api/business/events/${ended.id}/summary`).set('x-user-id',owner.id).expect(200);return res.body.data.event.canChangePaymentAccount;};
    await t.test('ended demo orders do not lock defaults or require historical offerings to be ready',async()=>{
      await selectDefault(fresh.id).expect(200);
      assert.equal((await org.reload()).defaultPaymentAccountId,fresh.id);
      assert.deepEqual((await demo.reload()).toJSON(),beforeDemo);
      assert.equal(await editable(),true);
      await selectEvent(fresh.id).expect(200);await selectEvent(null).expect(200);
      await accounts.selectDefault(owner.id,org.id,null);
      assert.equal((await org.reload()).defaultPaymentAccountId,null);
    });
    const order=await m.Order.create({buyerUserId:owner.id,eventId:ended.id,status:'paid',providerMode:'test',providerVerificationStatus:'verified',
      paymentAccountId:old.id,stripeAccountId:old.stripeAccountId,stripePaymentIntentId:`pi_${randomUUID().replaceAll('-','')}`,
      stripeChargeId:`ch_${randomUUID().replaceAll('-','')}`,totalCents:1000,idempotencyKey:randomUUID()});
    const payment=await m.Payment.create({orderId:order.id,provider:'stripe',providerReference:order.stripePaymentIntentId,status:'succeeded',amountCents:1000,currency:'USD',metadata:{stripeAccountId:old.stripeAccountId}});
    const refund=await m.Refund.create({orderId:order.id,paymentAccountId:old.id,stripeAccountId:old.stripeAccountId,amountCents:1000,status:'succeeded',
      idempotencyKey:randomUUID(),requestedByUserId:owner.id,reason:'Verified test refund'});
    const oldSnapshots=[order.toJSON(),payment.toJSON(),refund.toJSON()];
    await t.test('verified completed payments and refunds allow changes and retain every historical merchant snapshot',async()=>{
      await selectDefault(fresh.id).expect(200);assert.equal(await editable(),true);
      await selectEvent(fresh.id).expect(200);
      assert.deepEqual((await order.reload()).toJSON(),oldSnapshots[0]);
      assert.deepEqual((await payment.reload()).toJSON(),oldSnapshots[1]);
      assert.deepEqual((await refund.reload()).toJSON(),oldSnapshots[2]);
      await selectEvent(null).expect(200);
    });
    await t.test('pending, unverified and review payments block both routes even for ended events',async()=>{
      for(const state of [{status:'pending',providerVerificationStatus:'pending'},{status:'paid',providerVerificationStatus:'review'},
        {status:'refunded',providerVerificationStatus:'review'},{status:'paid',providerVerificationStatus:'pending'},
        {status:'cancelled',providerVerificationStatus:'pending'}]) {
        await order.update(state);
        const response=await selectDefault(old.id).expect(409);assert.equal(response.body.error.code,'PAYMENT_ACCOUNT_LOCKED');
        await selectEvent(old.id).expect(409);assert.equal(await editable(),false);
        assert.equal((await org.reload()).defaultPaymentAccountId,fresh.id);assert.equal((await ended.reload()).paymentAccountId,null);
      }
      await order.update({status:'paid',providerVerificationStatus:'verified'});
    });
    await t.test('pending and failed refunds block changes until resolved or explicitly cancelled',async()=>{
      for(const status of ['pending','failed']) {
        await refund.update({status});await selectDefault(old.id).expect(409);await selectEvent(old.id).expect(409);assert.equal(await editable(),false);
      }
      for(const status of ['succeeded','canceled','cancelled']) {
        await refund.update({status});await selectEvent(old.id).expect(200);await selectEvent(null).expect(200);assert.equal(await editable(),true);
      }
      await refund.update({status:'succeeded'});
    });
    await t.test('provider-confirmed expired checkout and full refund unlock selection',async()=>{
      for(const status of ['cancelled','refunded']) {
        await order.update({status,providerVerificationStatus:'verified'});
        await selectDefault(old.id).expect(200);await selectDefault(fresh.id).expect(200);assert.equal(await editable(),true);
      }
    });
    await t.test('unresolved explicit event overrides do not block an unrelated organization default',async()=>{
      await selectEvent(old.id).expect(200);await order.update({status:'pending',providerVerificationStatus:'pending'});
      await selectDefault(old.id).expect(200);await selectEvent(fresh.id).expect(409);
      assert.equal((await ended.reload()).paymentAccountId,old.id);
      await order.update({status:'paid',providerVerificationStatus:'verified'});await selectEvent(null).expect(200);
    });
    await t.test('new published paid events still require a ready selected account and roll back invalid defaults',async()=>{
      const future=await m.Event.create({organizationId:org.id,creatorUserId:owner.id,title:'Future paid night',slug:randomUUID(),status:'published',
        startsAt:new Date(Date.now()+3600000),endsAt:new Date(Date.now()+7200000)});
      await m.Offering.create({eventId:future.id,name:'Future ticket',priceCents:2000,quantityTotal:100});
      const response=await selectDefault(fresh.id).expect(409);assert.equal(response.body.error.code,'PAYMENTS_NOT_READY');
      assert.equal((await org.reload()).defaultPaymentAccountId,old.id);
      await future.update({status:'draft'});
    });
    await t.test('checkout and selection share the authorization fence so newly unresolved activity cannot race a change',async()=>{
      const held=deferred(),release=deferred();
      const concurrent=mutationTransaction(db,async transaction=>{
        await order.update({status:'pending',providerVerificationStatus:'pending'},{transaction});held.resolve();await release.promise;
      });
      await held.promise;
      let finished=false;
      const attempt=accounts.selectDefault(owner.id,org.id,fresh.id);
      attempt.then(()=>{finished=true;},()=>{finished=true;});
      const rejected=assert.rejects(attempt,{code:'PAYMENT_ACCOUNT_LOCKED'});
      try {
        await new Promise(resolve=>setTimeout(resolve,75));
        assert.equal(finished,false,'selection waits for the in-flight checkout transaction before reading settlement');
      } finally {release.resolve();}
      await concurrent;await rejected;
      assert.equal((await org.reload()).defaultPaymentAccountId,old.id);
      await order.update({status:'paid',providerVerificationStatus:'verified'});
      await accounts.selectDefault(owner.id,org.id,fresh.id);
    });
    await t.test('settlement never bypasses finance authorization or organization scoping',async()=>{
      await selectDefault(old.id,stranger.id).expect(403);await selectDefault(foreign.id).expect(404);await selectEvent(foreign.id).expect(404);
      assert.equal((await org.reload()).defaultPaymentAccountId,fresh.id);
    });
  } finally {await db.close();}
});

test('payment overview and own earnings retain verified currency evidence and finance scope',{timeout:30000},async()=>{
  assertManagedTestDatabase();
  const config=require('../src/config').getConfig();
  const db=require('../src/db/sequelize').createSequelize(config);
  const m=require('../src/db/models').initModels(db);
  try {
    const user=async name=>m.User.create({displayName:name,email:`${randomUUID()}@offline.nitewide.test`});
    const owner=await user('Payments owner'),manager=await user('Finance manager'),ordinary=await user('Ordinary manager'),promoter=await user('Promoter'),other=await user('Other promoter'),outsider=await user('Customer');
    const org=await m.Organization.create({name:'Payment reports',slug:`reports-${randomUUID()}`,onboardingEstablished:true});
    await m.OrganizationOwner.bulkCreate([{organizationId:org.id,userId:owner.id,role:'owner'},
      {organizationId:org.id,userId:manager.id,role:'admin',financeAuthorized:true},
      {organizationId:org.id,userId:ordinary.id,role:'admin',financeAuthorized:false}]);
    await m.OrganizationEmployee.create({organizationId:org.id,userId:promoter.id,status:'active'});
    const merchant=await m.PaymentAccount.create({organizationId:org.id,name:'Historical merchant',stripeAccountId:`acct_${randomUUID().replaceAll('-','')}`,mode:'test',accountApiVersion:'v2'});
    const event=await m.Event.create({organizationId:org.id,creatorUserId:owner.id,title:'Payments fixture',slug:`payments-${randomUUID()}`,startsAt:new Date(Date.now()+3600000),endsAt:new Date(Date.now()+7200000)});
    const ea=await m.EventAffiliate.create({eventId:event.id,userId:promoter.id,code:`own-${randomUUID()}`,commissionBps:500,accessScope:'event'});
    const otherEa=await m.EventAffiliate.create({eventId:event.id,userId:other.id,code:`other-${randomUUID()}`,commissionBps:500,accessScope:'event'});
    const oa=await m.OrgAffiliate.create({organizationId:org.id,userId:promoter.id,code:`org-${randomUUID()}`,defaultCommissionBps:500});
    const reports=createBusinessPaymentOverviewService({models:m});
    const reads=createBusinessReadService({models:m});
    assert.equal((await reads.bootstrap(promoter.id)).scope.canViewEarnings,true,'current commission grant exposes earnings before first payment');
    assert.equal((await reads.bootstrap(ordinary.id)).scope.canViewEarnings,false);
    await otherEa.update({commissionBps:0});
    assert.equal((await reads.bootstrap(other.id)).scope.canViewEarnings,true,'a zero-rate affiliate can enter Payments to complete individual onboarding');
    assert.deepEqual((await reports.earnings(other.id)).currencies,[]);
    await assert.rejects(reports.overview(other.id,org.id),{code:'FORBIDDEN'},'personal onboarding access never grants business finance access');
    const zeroOrgPromoter=await user('Zero-rate organization promoter');
    await m.OrgAffiliate.create({organizationId:org.id,userId:zeroOrgPromoter.id,code:`zero-${randomUUID()}`,defaultCommissionBps:0});
    assert.equal((await reads.bootstrap(zeroOrgPromoter.id)).scope.canViewEarnings,true,'zero-rate organization affiliates retain personal payment setup access');
    assert.deepEqual((await reports.earnings(zeroOrgPromoter.id)).currencies,[]);
    await assert.rejects(reports.overview(zeroOrgPromoter.id,org.id),{code:'FORBIDDEN'});
    async function order({status='paid',currency='USD',total=1100,commission=100,affiliate=ea.id,orgAffiliate=null,provider='stripe',proof=true,payment=true,verification='verified',paymentChanges={},changes={}}={}) {
      const stripeId=randomUUID().replaceAll('-','');
      const o=await m.Order.create({buyerUserId:owner.id,eventId:event.id,status,currency,subtotalCents:total-100,totalCents:total,affiliateCommissionCents:commission,
        eventAffiliateId:affiliate,orgAffiliateId:orgAffiliate,idempotencyKey:randomUUID(),
        ...(proof?{providerMode:'test',providerVerificationStatus:verification,paymentAccountId:merchant.id,stripeAccountId:merchant.stripeAccountId,
          stripePaymentIntentId:`pi_${stripeId}`,stripeChargeId:`ch_${stripeId}`} : {}),...changes});
      if(payment) await m.Payment.create({orderId:o.id,provider,providerReference:proof?o.stripePaymentIntentId:`demo-${randomUUID()}`,
        status:status==='refunded'?'refunded':'succeeded',amountCents:total,currency,metadata:proof?{stripeAccountId:merchant.stripeAccountId}:null,...paymentChanges});
      return o;
    }
    await order();await order({status:'refunded',total:2200,commission:200});
    await order({currency:'EUR',total:3300,commission:300});
    await order({affiliate:null,orgAffiliate:oa.id,total:4400,commission:400});
    await order({affiliate:otherEa.id,orgAffiliate:oa.id,total:5500,commission:500});
    await order({provider:'demo',proof:false,total:6600,commission:600});
    await order({provider:'mock',proof:false,status:'refunded',total:7700,commission:700});
    await order({proof:false,payment:false,total:8800,commission:800});
    await order({provider:'manual',proof:false,total:9900,commission:900});
    await order({payment:false,total:1200,commission:120});
    await order({paymentChanges:{metadata:{stripeAccountId:'acct_wrong'}},total:1300,commission:130});
    await order({paymentChanges:{amountCents:1},total:1400,commission:140});
    await order({paymentChanges:{currency:'EUR'},total:1500,commission:150});
    await order({verification:'review',total:1600,commission:160});
    await order({status:'pending',payment:false});await order({status:'pending',verification:'review',payment:false});
    await order({changes:{providerMode:'live'},total:1700,commission:170});
    const overview=paymentSchemas.paymentOverview.parse(await reports.overview(owner.id,org.id));
    const usd=overview.currencies.find(row=>row.currency==='USD');
    assert.deepEqual(usd,{currency:'USD',collectedCents:13200,refundedCents:2200,netCollectedCents:11000,paidOrders:3,refundedOrders:1,pendingOrders:1,reviewOrders:2});
    assert.equal(overview.currencies.find(row=>row.currency==='EUR').collectedCents,3300);
    assert.equal(overview.merchantBalance,null);assert.equal(overview.payouts,null);
    assert.deepEqual(await reports.overview(manager.id,org.id),overview);
    for(const denied of [ordinary,promoter,other,outsider]) await assert.rejects(reports.overview(denied.id,org.id),{code:'FORBIDDEN'});
    const earnings=paymentSchemas.paymentEarnings.parse(await reports.earnings(promoter.id));
    assert.deepEqual(await reports.earnings(promoter.id,{organizationId:org.id}),earnings,'a selected organization retains only the recipient’s own evidence');
    assert.deepEqual((await reports.earnings(promoter.id,{organizationId:randomUUID()})).currencies,[],'a foreign scope cannot expose another business or recipient’s earnings');
    assert.deepEqual((await reports.earnings(promoter.id,{organizationId:'independent'})).currencies,[],'organization earnings do not leak into independent-event scope');
    assert.deepEqual(earnings.currencies.find(row=>row.currency==='USD'),{currency:'USD',verifiedEarnedCents:500,verifiedRefundedCents:200,demoEarnedCents:600,demoRefundedCents:700,
      verifiedPaidOrders:2,verifiedRefundedOrders:1,demoPaidOrders:1,demoRefundedOrders:1,
      unpaidCommissionCents:0,heldCommissionCents:0,payableCommissionCents:0,reservedCommissionCents:0,paidCommissionCents:0,businessLossCents:0});
    assert.equal(earnings.currencies.find(row=>row.currency==='EUR').verifiedEarnedCents,300);
    assert.deepEqual(earnings.receivedPayouts,{currencies:[],bankPayouts:null});assert.equal(earnings.dashboardConnected,null);
    await merchant.update({chargesEnabled:true,detailsSubmitted:true,cardPaymentsActive:true,controllerMatches:true,payoutsEnabled:true,synchronizedAt:new Date()});
    assert.deepEqual(await reports.earnings(promoter.id),earnings,'merchant readiness cannot substitute for individual Stripe onboarding or prove received payouts');
    const otherEarnings=await reports.earnings(other.id);assert.equal(otherEarnings.currencies[0].verifiedEarnedCents,500,'event attribution wins over organization fallback');
    await ea.update({status:'inactive'});await oa.update({status:'inactive'});
    assert.deepEqual(await reports.earnings(promoter.id),earnings,'historical commission survives revoked grants with business access');
    assert.equal((await reads.bootstrap(promoter.id)).scope.canViewEarnings,true);
    await assert.rejects(reports.earnings(outsider.id),{code:'FORBIDDEN'});
    await assert.rejects(reports.earnings(ordinary.id),{code:'FORBIDDEN'});
    const app=createApp({sequelize:db,models:m,config});
    const api=(path,userId)=>request(app).get(`/api${path}`).set('x-user-id',userId);
    await api('/business/payments/earnings',promoter.id).query({userId:other.id}).expect(422);
    const response=await api('/business/payments/earnings',promoter.id).expect(200).expect('Cache-Control','no-store');
    paymentSchemas.paymentEarnings.parse(response.body.data);assert.deepEqual(response.body.data,earnings);
    await api(`/business/organizations/${org.id}/payment-overview`,manager.id).expect(200);
    await api(`/business/organizations/${org.id}/payment-overview`,ordinary.id).expect(403);
    await m.OrganizationOwner.update({financeAuthorized:false},{where:{organizationId:org.id,userId:manager.id}});
    await assert.rejects(reports.overview(manager.id,org.id),{code:'FORBIDDEN'},'finance revocation takes effect on the next read');
    await m.OrganizationEmployee.update({status:'inactive'},{where:{organizationId:org.id,userId:promoter.id}});
    assert.deepEqual(await reports.earnings(promoter.id),earnings,'own historical earnings remain available outside business admission');
    await api('/business/bootstrap',promoter.id).expect(403);
    await api('/account/commission-earnings',promoter.id).expect(200);
  } finally {await db.close();}
});
