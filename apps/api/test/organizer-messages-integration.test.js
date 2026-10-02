const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { request } = require('./support/http-client.cjs');
const { mutationTransaction, AUTHORIZATION_FENCE } = require('../src/services/mutation-transaction');

test('booking conversations are private, retryable, notification-only and hold only timely disputed earnings', {timeout:60000}, async () => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const sequelize = require('../src/db/sequelize').createSequelize(config);
  const m = require('../src/db/models').initModels(sequelize);
  const { createOrganizerMessageService } = require('../src/services/organizer-message-service');
  const { createNotificationService } = require('../src/services/notification-service');
  const { signToken } = require('../src/services/auth-service');
  const users = {}, tokens = {};
  let clock = new Date(), server, providerCalls=0, failProvider=true;
  const refunds = { requestRefund: async (_user,orderId,input) => {
    providerCalls++; assert.match(input.idempotencyKey,/^organizer-refund\//);
    if (failProvider) throw new Error('Simulated provider timeout');
    return {refundId:randomUUID(),orderId,status:'succeeded'};
  }};
  const service = createOrganizerMessageService({models:m,notifications:createNotificationService(m),refunds,now:()=>clock});
  try {
    await sequelize.authenticate();
    for (const role of ['owner','manager','promoter','buyer','other']) {
      users[role]=await m.User.create({displayName:`Messages ${role}`,email:`test+messages-${role}-${randomUUID()}@nitewide.com`});
      const session=await m.AuthSession.create({userId:users[role].id,expiresAt:new Date(Date.now()+600000)});
      tokens[role]=signToken({sub:users[role].id,sid:session.id,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,pwd:null},config.AUTH_TOKEN_SECRET);
    }
    const org=await m.Organization.create({name:'Messages business',slug:`messages-${randomUUID()}`});
    await m.OrganizationOwner.bulkCreate([{organizationId:org.id,userId:users.owner.id,role:'owner'},
      {organizationId:org.id,userId:users.manager.id,role:'admin',financeAuthorized:false}]);
    await m.OrgAffiliate.create({organizationId:org.id,userId:users.promoter.id,code:`MSG-${randomUUID()}`});
    const event=await m.Event.create({organizationId:org.id,creatorUserId:users.owner.id,title:'Messages night',slug:`msg-${randomUUID()}`,
      startsAt:new Date(+clock+3600000),endsAt:new Date(+clock+7200000),status:'published'});
    const affiliate=await m.EventAffiliate.create({eventId:event.id,userId:users.promoter.id,code:`MSG-EVENT-${randomUUID()}`});
    const makeOrder=(totalCents=2200)=>m.Order.create({eventId:event.id,buyerUserId:users.buyer.id,status:'paid',paidAt:clock,
      subtotalCents:totalCents?2000:0,totalCents,affiliateCommissionCents:totalCents?500:0,
      eventAffiliateId:totalCents?affiliate.id:null,providerMode:totalCents?'test':null,providerVerificationStatus:totalCents?'verified':'pending',idempotencyKey:randomUUID()});
    const [order,otherOrder,free]=await Promise.all([makeOrder(),makeOrder(),makeOrder(0)]);
    const statement=await m.CommissionStatement.create({organizationId:org.id,eventId:event.id,recipientUserId:users.promoter.id,
      eventTitle:event.title,currency:'USD',availableAt:new Date(+clock-1)});
    for(const o of [order,otherOrder]) await m.CommissionEarning.create({orderId:o.id,organizationId:org.id,eventId:event.id,
      recipientUserId:users.promoter.id,statementId:statement.id,currency:'USD',originalCommissionCents:500,unpaidCommissionCents:500,snapshot:{}});
    const app=require('../src/app').createApp({sequelize,models:m,config,services:{refunds}});
    server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
    const contact={body:'Can I change my plans? <script>alert(1)</script>',kind:'refund',idempotencyKey:randomUUID()};
    const response=await request(server,`/api/customer/orders/${order.id}/messages`,{method:'POST',token:tokens.buyer,body:contact});
    assert.equal(response.status,200,JSON.stringify(response.body));
    const threadId=response.body.data.thread.id;
    assert.equal(response.body.data.messages.items[0].body,contact.body,'text is preserved for escaped React rendering');
    assert.equal(await m.EmailOutbox.count(),0,'organizer contact never sends email');
    assert.equal((await m.CommissionEarning.findOne({where:{orderId:order.id}})).refundHold,true);
    assert.equal((await m.CommissionEarning.findOne({where:{orderId:otherOrder.id}})).refundHold,false);
    assert.equal((await order.reload()).status,'paid','request does not cancel admission');
    await request(server,`/api/customer/orders/${order.id}/messages`,{method:'POST',token:tokens.buyer,body:contact}).expect(200);
    assert.equal(await m.OrganizerMessage.count(),1);
    assert.equal(await m.Notification.count({where:{kind:'organizer_message'}}),2,'current owner and manager, not promoter');
    await request(server,`/api/customer/orders/${otherOrder.id}/messages`,{method:'POST',token:tokens.buyer,body:contact}).expect(409);
    await request(server,`/api/customer/messages/${threadId}`,{token:tokens.other}).expect(404);
    await request(server,`/api/business/messages/${threadId}`,{token:tokens.promoter}).expect(404);
    const inbox=await request(server,'/api/business/messages',{token:tokens.manager}); assert.equal(inbox.body.data.unreadCount,1);
    await request(server,`/api/business/messages/${threadId}/read`,{method:'POST',token:tokens.manager,body:{}}).expect(200);
    assert.equal((await service.list(users.manager.id,'business')).unreadCount,0);
    assert.equal((await service.list(users.owner.id,'business')).unreadCount,1,'read states are per operator');
    const decision={decision:'deny',reason:'Organizer declined this request',idempotencyKey:randomUUID()};
    await request(server,`/api/business/orders/${order.id}/refund-request`,{method:'PATCH',token:tokens.manager,body:decision}).expect(403);
    await request(server,`/api/business/orders/${order.id}/refund-request`,{method:'PATCH',token:tokens.owner,body:decision}).expect(200);
    await request(server,`/api/business/orders/${order.id}/refund-request`,{method:'PATCH',token:tokens.owner,body:decision}).expect(200);
    assert.equal(providerCalls,0); assert.equal((await m.CommissionEarning.findOne({where:{orderId:order.id}})).refundHold,false);
    const reply={body:'Happy to help with your booking.',idempotencyKey:randomUUID()};
    await Promise.all([service.reply(users.manager.id,'business',threadId,reply),service.reply(users.manager.id,'business',threadId,reply)]);
    assert.equal(await m.OrganizerMessage.count({where:{idempotencyKey:reply.idempotencyKey}}),1);
    assert.equal((await service.list(users.buyer.id,'customer')).unreadCount,1);
    await assert.rejects(service.contact(users.buyer.id,free.id,{body:'Refund free entry',kind:'refund',idempotencyKey:randomUUID()}),{code:'REFUND_REQUEST_CLOSED'});
    await service.contact(users.buyer.id,free.id,{body:'Where is the entrance?',kind:'question',idempotencyKey:randomUUID()});
    const second=await service.contact(users.buyer.id,otherOrder.id,{body:'Please cancel this booking',kind:'cancellation',idempotencyKey:randomUUID()});
    const offering=await m.Offering.create({eventId:event.id,name:'Report fixture',priceCents:1000,quantityTotal:50});
    for(const o of [order,otherOrder]) await m.OrderItem.bulkCreate([{orderId:o.id,offeringId:offering.id,nameSnapshot:'First portion',kindSnapshot:'ticket',quantity:1,entriesPerUnitSnapshot:1,unitPriceCents:901,lineTotalCents:901},
      {orderId:o.id,offeringId:offering.id,nameSnapshot:'Second portion',kindSnapshot:'ticket',quantity:1,entriesPerUnitSnapshot:1,unitPriceCents:1099,lineTotalCents:1099}]);
    const ledger=require('../src/services/commission-ledger-service').createCommissionLedgerService({sequelize,models:m});
    await ledger.adjustRefund({order:otherOrder,cumulativeRefundedTotalCents:1100});
    const reads=require('../src/services/business-read-service').createBusinessReadService({models:m});
    const reports=require('../src/services/business-report-service').createBusinessReportService({models:m,businessRead:reads});
    const query=require('../src/http/business-schemas').reportDetailQuery.parse({days:30,eventId:event.id});
    const stats=await reports.summary(users.owner.id,query);
    assert.equal(stats.summary.salesCents,3000,'verified half refund reduces sales, not immutable face value');
    assert.equal(stats.summary.commissionCents,750,'only unpaid earnings are reduced');
    const lines=await sequelize.query(`SELECT SUM(net) AS total FROM (SELECT ${require('../src/services/refund-report-policy').netItemSql('oi','o')} AS net FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.id=:id) items`,{replacements:{id:otherOrder.id}});
    assert.equal(Number(lines[0][0].total),1000,'line allocation rounds the exact cumulative refund once');
    const eventRead=require('../src/services/business-event-read-service').createBusinessEventReadService({models:m});
    assert.equal((await eventRead.summary(users.owner.id,event.id)).summary.salesCents,3000);
    const overview=await reads.overview(users.owner.id,require('../src/http/business-schemas').reportQuery.parse({days:30}));
    assert.equal(overview.summary.salesCents,3000,'overview uses the same net sales policy');
    // A genuinely paid commission remains a business expense after a full
    // ticket refund, without resurrecting the refunded booking's sales/counts.
    await m.CommissionEarning.update({unpaidCommissionCents:0,paidCommissionCents:500},{where:{orderId:order.id}});
    await ledger.adjustRefund({order,cumulativeRefundedTotalCents:order.totalCents});
    await order.update({status:'refunded'});
    const afterRefund=await reports.summary(users.owner.id,query);
    assert.equal(afterRefund.summary.salesCents,1000);
    assert.equal(afterRefund.summary.commissionCents,750,'retained paid 500 plus adjusted unpaid 250');
    assert.equal(afterRefund.summary.orders,2,'remaining paid booking and free claim, but not refunded purchase');
    assert.equal(afterRefund.summary.units,2,'refunded purchases add no sold units');
    assert.equal((await eventRead.summary(users.owner.id,event.id)).summary.commissionCents,750);
    const eventTeam=await eventRead.people(users.owner.id,event.id,{page:1,pageSize:10});
    assert.equal(eventTeam.items.find(row=>row.userId===users.promoter.id).commissionCents,750,'event team retains paid commission cost');
    assert.equal((await reads.overview(users.owner.id,require('../src/http/business-schemas').reportQuery.parse({days:30}))).summary.commissionCents,750);
    clock=new Date(+event.startsAt);
    const late=await makeOrder();
    await assert.rejects(service.contact(users.buyer.id,late.id,{body:'Please refund',kind:'refund',idempotencyKey:randomUUID()}),{code:'REFUND_REQUEST_CLOSED'});
    clock=new Date(+event.endsAt+365*86400000);
    await service.reply(users.manager.id,'business',second.thread.id,{body:'We can still resolve your timely request.',idempotencyKey:randomUUID()});
    const approval={decision:'approve',reason:'Approved after organizer review',idempotencyKey:randomUUID()};
    await assert.rejects(service.resolve(users.owner.id,otherOrder.id,approval),/Simulated provider timeout/);
    assert.equal((await service.detail(users.owner.id,'business',second.thread.id)).canResolveRefund,true,'committed approvals remain retryable');
    failProvider=false;
    assert.equal((await service.resolve(users.owner.id,otherOrder.id,approval)).request.status,'resolved');
    assert.equal(providerCalls,2);
    await assert.rejects(service.resolve(users.owner.id,otherOrder.id,{...approval,reason:'Different terms'}),{code:'REFUND_DECISION_CONFLICT'});
    let unlock,started;
    const held=new Promise(resolve=>{unlock=resolve}),ready=new Promise(resolve=>{started=resolve});
    const revocation=mutationTransaction(sequelize,async transaction=>{
      await m.OrganizationOwner.update({lifecycleState:'archived'},{where:{organizationId:org.id,userId:users.manager.id},transaction}); started();await held;
    },{accessChange:true});
    await ready;
    const raced=service.reply(users.manager.id,'business',threadId,{body:'Should not be sent',idempotencyKey:randomUUID()});
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){const [rows]=await sequelize.query(`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=${AUTHORIZATION_FENCE[0]} AND objid=${AUTHORIZATION_FENCE[1]} AND NOT granted`);if(rows.length)break;await new Promise(resolve=>setTimeout(resolve,10));}
    const assertion=assert.rejects(raced,{code:'NOT_FOUND'}); unlock(); await revocation;await assertion;
    assert.equal(await m.OrganizerMessage.count({where:{body:'Should not be sent'}}),0);
    await request(server,'/api/customer/messages?pageSize=100',{token:tokens.buyer}).expect(422);
    assert.equal(await m.EmailOutbox.count(),0);
  } finally { if(server)await new Promise(resolve=>server.close(resolve));await sequelize.close(); }
});

test('independently verified purchase disputes isolate holds and reject stale concurrent success', {timeout:30000}, async()=>{
  assertManagedTestDatabase();
  const sequelize=require('../src/db/sequelize').createSequelize(require('../src/config').getConfig());
  const m=require('../src/db/models').initModels(sequelize);
  try {
    const owner=await m.User.create({displayName:'Dispute owner',email:`test+dispute-owner-${randomUUID()}@nitewide.com`});
    const buyer=await m.User.create({displayName:'Dispute buyer',email:`test+dispute-buyer-${randomUUID()}@nitewide.com`});
    const org=await m.Organization.create({name:'Dispute business',slug:`dispute-${randomUUID()}`});
    const event=await m.Event.create({organizationId:org.id,creatorUserId:owner.id,title:'Dispute night',slug:`dispute-${randomUUID()}`,
      startsAt:new Date(Date.now()-4*86400000),endsAt:new Date(Date.now()-3*86400000),status:'published'});
    const account=await m.PaymentAccount.create({organizationId:org.id,name:'Dispute merchant',mode:'test',stripeAccountId:'acct_disputetest'});
    const statement=await m.CommissionStatement.create({organizationId:org.id,eventId:event.id,recipientUserId:owner.id,eventTitle:event.title,currency:'USD',availableAt:new Date(Date.now()-86400000)});
    const order=await m.Order.create({eventId:event.id,buyerUserId:buyer.id,status:'paid',paidAt:new Date(),subtotalCents:2000,totalCents:2200,
      affiliateCommissionCents:500,applicationFeeCents:200,paymentAccountId:account.id,stripeAccountId:account.stripeAccountId,
      stripeChargeId:'ch_disputetest',stripePaymentIntentId:'pi_disputetest',providerMode:'test',providerVerificationStatus:'verified',idempotencyKey:randomUUID()});
    const otherOrder=await m.Order.create({eventId:event.id,buyerUserId:buyer.id,status:'paid',paidAt:new Date(),subtotalCents:2000,totalCents:2200,affiliateCommissionCents:500,idempotencyKey:randomUUID()});
    for(const o of [order,otherOrder]) await m.CommissionEarning.create({orderId:o.id,organizationId:org.id,eventId:event.id,recipientUserId:owner.id,statementId:statement.id,currency:'USD',originalCommissionCents:500,unpaidCommissionCents:500,snapshot:{}});
    let status='needs_response',badAmount=false,fetches=0,paused=false,release,ready;
    const charge={id:order.stripeChargeId,object:'charge',livemode:false,payment_intent:order.stripePaymentIntentId,amount:2200,application_fee_amount:200,currency:'usd',paid:true,captured:true};
    const intent={id:order.stripePaymentIntentId,object:'payment_intent',livemode:false,latest_charge:order.stripeChargeId,metadata:{orderId:order.id},amount:2200,application_fee_amount:200,currency:'usd',status:'succeeded'};
    const stripe={enabled:true,mode:'test',retrieveDispute:async(id,options)=>{
      assert.equal(options.stripeAccount,account.stripeAccountId); fetches++;
      const result={id,object:'dispute',livemode:false,status,charge:order.stripeChargeId,payment_intent:order.stripePaymentIntentId,currency:'usd',amount:badAmount?0:2200};
      if(paused && fetches===2){ready();await new Promise(resolve=>{release=resolve;});}
      return result;
    },retrieveCharge:async()=>charge,retrievePaymentIntent:async()=>intent};
    const ledger=require('../src/services/commission-ledger-service').createCommissionLedgerService({sequelize,models:m});
    const service=require('../src/services/stripe-dispute-service').createStripeDisputeService({sequelize,models:m,stripe,ledger});
    const notification=id=>({id:`evt_${randomUUID()}`,type:'charge.dispute.created',account:account.stripeAccountId,livemode:false,data:{object:{id,status:'won'}}});
    await service.reconcileDisputeEvent(notification('du_first'),account);
    assert.equal((await m.CommissionEarning.findOne({where:{orderId:order.id}})).disputeHold,true,'payload success cannot bypass independently retrieved open dispute');
    assert.equal((await m.CommissionEarning.findOne({where:{orderId:otherOrder.id}})).disputeHold,false);
    await ledger.setRefundHold({orderId:order.id,hold:true});
    status='won'; await service.reconcileDisputeEvent(notification('du_first'),account);
    const released=await m.CommissionEarning.findOne({where:{orderId:order.id}});
    assert.equal(released.disputeHold,false);assert.equal(released.refundHold,true,'dispute resolution never clears refund request hold');
    badAmount=true;
    await assert.rejects(service.reconcileDisputeEvent(notification('du_bad'),account),{code:'DISPUTE_VERIFICATION_FAILED'});
    assert.equal((await m.PurchaseDispute.findOne({where:{stripeDisputeId:'du_bad'}})).status,'unverified');
    badAmount=false;status='won';fetches=0;paused=true;
    const barrier=new Promise(resolve=>{ready=resolve;});
    const stale=service.reconcileDisputeEvent(notification('du_race'),account);
    await barrier;status='lost';paused=false;
    await service.reconcileDisputeEvent(notification('du_race'),account);
    release();await stale;
    assert.equal((await m.PurchaseDispute.findOne({where:{stripeDisputeId:'du_race'}})).status,'lost','stale success cannot overwrite later loss');
    assert.equal((await m.CommissionEarning.findOne({where:{orderId:order.id}})).disputeHold,true);
    assert.equal((await order.reload()).status,'paid','dispute hold does not invent a customer refund');
  }finally{await sequelize.close();}
});
