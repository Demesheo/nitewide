const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessEventReuseService } = require('../src/services/business-event-reuse-service');

function fixture({invalidPricing = false, commissionBps = 0} = {}) {
  const queries = [],transaction = {LOCK:{UPDATE:'UPDATE'}},now = new Date('2030-10-01');
  const source = {id:'source',organizationId:'org',locationId:'venue'},target = {id:'target',organizationId:'org',locationId:'venue',status:'draft',endsAt:new Date('2030-10-02')};
  const models = {Event:{findByPk:async () => target,sequelize:{transaction:async (_,work) => work(transaction),query:async (sql,options) => {
    queries.push({sql,options});
    if (sql.includes('pg_advisory')) return [];
    if (sql.startsWith('SELECT COALESCE(MAX')) return [{commissionBps}];
    if (sql.startsWith('SELECT e.id AS')) return invalidPricing ? [{eventId:'target',eventFeeMode:'absorbed',offeringId:'tier',name:'Unsafe tier',priceCents:100,minPerOrder:1,maxPerOrder:1,feeMode:'inherit',currency:'USD',isActive:true}] : [];
    if (sql.startsWith('SELECT e.id')) return [{id:'target'}];
    if (sql.startsWith('INSERT')) return [{id:'copy'}];
    throw new Error(`Unexpected SQL: ${sql}`);
  }}},Offering:{},Order:{count:async () => 0},GuestlistEntry:{count:async () => 0},AuditLog:{create:async () => {}}};
  const permissions = {assertManageEvent:async (_,id,tx) => {assert.equal(tx,transaction);return id === 'source' ? source : target;}};
  return {queries,transaction,now,service:createBusinessEventReuseService({models,permissions,now:() => now})};
}

test('draft team copy preserves only active exact-venue bindings and checks current periods in both eligible terms and insert', async () => {
  const f = fixture();
  assert.equal((await f.service.copyAccess('actor','target',{sourceEventId:'source',copyTeam:true,copyAllocations:false})).copied,1);
  const eligibility = f.queries.find(query => query.sql.startsWith('SELECT COALESCE(MAX')),insert = f.queries.find(query => query.sql.startsWith('INSERT'));
  for (const query of [eligibility,insert]) {
    assert.match(query.sql,/current_venue\.id=source\.venue_access_id/);
    assert.match(query.sql,/current_venue\.status='active'/);
    assert.match(query.sql,/source_event\.organization_id = :targetOrganizationId AND source_event\.location_id = :targetLocationId/);
    assert.match(query.sql,/source\.starts_at <= :now/); assert.match(query.sql,/source\.ends_at >= :now/);
    assert.equal(query.options.replacements.targetLocationId,'venue'); assert.equal(query.options.transaction,f.transaction);
  }
  assert.match(insert.sql,/access_scope, venue_access_id/);
  assert.match(insert.sql,/THEN source\.venue_access_id ELSE NULL END/);
  assert.ok(f.queries.some(query => query.sql.startsWith('SELECT e.id AS')),'commission viability is checked before copying');
});

test('unsafe copied commission terms are rejected before any assignment insert', async () => {
  const f = fixture({invalidPricing:true});
  await assert.rejects(f.service.copyAccess('actor','target',{sourceEventId:'source',copyTeam:true,copyAllocations:true}),{code:'PRICING_EDITOR_INVALID'});
  assert.equal(f.queries.some(query => query.sql.startsWith('INSERT')),false);
});
test('legacy copied terms preserve team access while individual eligibility holds future commissions at zero', async () => {
  const f = fixture({ commissionBps: 4000 });
  assert.equal((await f.service.copyAccess('actor','target',{sourceEventId:'source',copyTeam:true,copyAllocations:true})).copied,1);
  assert.match(f.queries.find(query => query.sql.startsWith('INSERT')).sql, /source\.commission_bps/);
});
