const test = require('node:test');
const assert = require('node:assert/strict');
const { offeringSaleState, assertEventEditable } = require('../src/domain/event-policy');
const { eventEditor } = require('../src/http/business-schemas');
const { summarizeEvent, createEventWorkspaceService } = require('../src/services/event-workspace-service');

test('tier release accepts sellout, scheduled close, or manual close while respecting its own window', () => {
  const now = new Date('2030-10-01T12:00:00Z');
  const early = { id:'early',isActive:true,inventoryMode:'finite',quantityTotal:10,quantitySold:9 };
  const late = { isActive:true,inventoryMode:'finite',quantityTotal:20,quantitySold:0,releaseAfterOfferingId:'early' };
  assert.equal(offeringSaleState(late,[early],now),'waiting_for_tier');
  early.quantitySold = 10;
  assert.equal(offeringSaleState(late,[early],now),'on_sale');
  early.quantitySold = 9;
  early.salesEndAt = new Date('2030-10-01T11:59:59Z');
  assert.equal(offeringSaleState(late,[early],now),'on_sale');
  early.salesEndAt = new Date('2030-10-01T12:00:01Z');
  assert.equal(offeringSaleState(late,[early],now),'waiting_for_tier');
  early.isActive = false;
  assert.equal(offeringSaleState(late,[early],now),'on_sale');
  assert.equal(offeringSaleState({...late,salesStartAt:'2030-10-02'},[early],now),'scheduled');
  assert.equal(offeringSaleState({...late,salesEndAt:now},[early],now),'closed');
  assert.equal(offeringSaleState({...late,quantitySold:20},[early],now),'sold_out');
  assert.equal(offeringSaleState(late,[],now),'waiting_for_tier');
});
test('events become read-only at their end time or completed status', () => {
  const now = new Date('2030-10-01T12:00:00Z');
  assert.throws(() => assertEventEditable({endsAt:now,status:'published'},now),{code:'EVENT_FINISHED'});
  assert.throws(() => assertEventEditable({endsAt:'2030-10-02',status:'completed'},now),{code:'EVENT_FINISHED'});
  assert.doesNotThrow(() => assertEventEditable({endsAt:'2030-10-02',status:'published'},now));
});
test('event report reconciles historical amounts, direct sales, referrer earnings and guestlist-only customers', () => {
  const report = summarizeEvent({
    offerings:[{id:'tier',name:'Current title',kind:'package',priceCents:99999}],
    people:[{id:'aff',userId:'employee',name:'Employee',role:'Employee',commissionBps:4000}],
    orders:[{buyerUserId:'customer',buyer:{displayName:'Buyer'},subtotalCents:30000,totalCents:32329,platformFeeCents:2329,affiliateCommissionCents:3000,eventAffiliateId:'aff',items:[{offeringId:'tier',nameSnapshot:'Original package',kindSnapshot:'package',quantity:1,lineTotalCents:30000,tickets:[{holderUserId:'customer',status:'checked_in'},{holderUserId:'friend',holder:{displayName:'Friend'},status:'valid'}]}]},
      {buyerUserId:'customer',buyer:{displayName:'Buyer'},subtotalCents:1000,totalCents:1154,platformFeeCents:154,affiliateCommissionCents:0,items:[]}],
    guests:[{userId:'guest',user:{displayName:'Guest only'},status:'no_show',partySize:2}],
  });
  assert.equal(report.summary.salesCents,31000);
  assert.equal(report.summary.customerPaidCents,33483);
  assert.equal(report.summary.commissionCents,3000);
  assert.equal(report.summary.customers,1);
  assert.equal(report.summary.admissions,2);
  assert.equal(report.summary.checkedIn,1);
  assert.equal(report.people[0].commissionCents,3000,'current rate must not recompute earned commission');
  assert.equal(report.people[0].customers,1);
  assert.equal(report.channels.find((c) => c.name === 'Direct').salesCents,1000);
  assert.equal(report.customers.find((c) => c.id === 'guest').salesCents,0);
  assert.equal(report.customers.find((c) => c.id === 'friend').admissions,1);
  assert.equal(report.customers.find((c) => c.id === 'customer').purchases[0].name,'Original package');
  assert.equal(report.customers.find((c) => c.id === 'customer').salesCents,31000,'total spend excludes customer fees');
});

test('event team includes the full active venue roster with zero activity without widening employee access', async () => {
  const member = (userId, extra = {}) => ({ userId, user: { id:userId, displayName:userId, email:`${userId}@example.test`, isActive:true }, ...extra });
  const event = { id:'event', organizationId:'venue', endsAt:'2030-10-02', offerings:[], toJSON() { return {id:this.id,organizationId:this.organizationId,endsAt:this.endsAt}; } };
  const models = {
    Event:{findByPk:async () => event}, Location:{}, Organization:{}, Offering:{}, OrderItem:{}, Ticket:{},
    User:{findByPk:async () => ({isActive:true})},
    OrganizationOwner:{findAll:async () => [member('owner',{role:'owner'}),member('manager',{role:'manager'})]},
    OrganizationEmployee:{findAll:async (query) => {
      assert.equal(query.where.organizationId,'venue');
      assert.equal(query.where.status,'active');
      return [member('employee'), member('selected'), member('disabled',{user:{isActive:false}})];
    }},
    OrgAffiliate:{findAll:async () => [member('promoter',{id:'org-promoter'}),member('manager',{id:'org-manager'})],findOne:async () => null},
    EventAffiliate:{findAll:async () => [member('selected',{id:'assignment',status:'active',commissionBps:1500}),member('removed',{id:'old-assignment',status:'inactive',commissionBps:1000})]},
    Order:{findAll:async () => []}, GuestlistEntry:{findAll:async () => []},
  };
  const service = createEventWorkspaceService({models,permissions:{canManageOrganization:async (id) => id === 'owner' || id === 'manager'},now:() => new Date('2030-10-01')});
  for (const viewer of ['owner','manager']) {
    const report = await service.detail(viewer,'event');
    assert.deepEqual(report.people.map((p) => p.userId).sort(),['employee','manager','owner','promoter','removed','selected']);
    assert.equal(report.people.filter((p) => p.userId === 'manager').length,1,'multiple venue roles must not duplicate people');
    assert.equal(report.people.find((p) => p.userId === 'manager').role,'Manager');
    for (const roleId of ['owner','manager']) {
      const leader = report.people.find((p) => p.userId === roleId);
      assert.equal(leader.status,'default');
      assert.equal(leader.commissionBps,0);
      assert.match(leader.code,/^LEAD-/);
    }
    const employee = report.people.find((p) => p.userId === 'employee');
    assert.equal(employee.status,'default');
    assert.match(employee.code,/^STAFF-/);
    assert.equal(employee.id,null,'visibility must not create an event assignment');
    for (const key of ['salesCents','orders','customers','commissionCents']) assert.equal(employee[key],0);
    assert.equal(report.people.find((p) => p.userId === 'selected').commissionBps,1500);
    assert.equal(report.people.find((p) => p.userId === 'removed').status,'inactive');
  }
  for (const viewer of ['employee','promoter']) {
    const report = await service.detail(viewer,'event');
    assert.deepEqual(report.people.map((p) => p.userId),[viewer]);
    assert.equal(report.scope,'own');
    assert.equal(report.event.canEdit,false);
    assert.deepEqual(report.candidates,[]);
  }
  await assert.rejects(service.detail('outsider','event'),{status:403});
});

test('editor rejects cyclic, cross-kind and cheaper successor tiers', () => {
  const tier = {name:'Early',kind:'ticket',priceCents:1000,inventoryMode:'finite',quantityTotal:10,entriesPerUnit:1,minPerOrder:1,maxPerOrder:5,isActive:true};
  const event = {organizationId:'30000000-0000-4000-8000-000000000001',title:'A show',summary:'',description:'',startsAt:'2030-10-01',endsAt:'2030-10-02',guestlistCapacity:0,capacity:null,status:'draft',isDiscoverable:true,offerings:[tier,{...tier,name:'Later',priceCents:2000,releaseAfterIndex:0}]};
  assert.equal(eventEditor.safeParse(event).success,true,'slug/category/location are not required for venue events');
  assert.equal(eventEditor.safeParse({...event,offerings:[tier,{...event.offerings[1],releaseAfterIndex:1}]}).success,false);
  assert.equal(eventEditor.safeParse({...event,offerings:[tier,{...event.offerings[1],priceCents:500}]}).success,false);
  assert.equal(eventEditor.safeParse({...event,offerings:[tier,{...event.offerings[1],kind:'package'}]}).success,false);
  assert.equal(eventEditor.safeParse({...event,offerings:[{...tier,isActive:false},event.offerings[1]]}).success,true,'a manually closed predecessor is a valid release rule');
  assert.equal(eventEditor.safeParse({...event,offerings:[{...tier,kind:'package'}, {...event.offerings[1],kind:'package'}]}).success,true,'package ladders are supported');
  assert.equal(eventEditor.safeParse({...event,offerings:[{...tier,inventoryMode:'unlimited',quantityTotal:null},event.offerings[1]]}).success,false);
  assert.equal(eventEditor.safeParse({...event,offerings:[{...tier,kind:'reservation'}, {...event.offerings[1],kind:'reservation'}]}).success,false);
});
