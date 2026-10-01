const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventWorkspaceService } = require('../src/services/event-workspace-service');

function fixture({ grantRole = 'promoter', grantCurrent = true, wrongVenue = false, existing = null } = {}) {
  const transaction = { LOCK: { UPDATE:'UPDATE',SHARE:'SHARE' } };
  const event = { id:'event',organizationId:'org',locationId:'beta',status:'published',endsAt:new Date('2030-10-02') };
  const user = { id:'recipient',isActive:true,displayName:'Recipient',email:'recipient@example.test' };
  const grant = { id:'venue-grant',organizationId:'org',locationId:wrongVenue ? 'alpha' : 'beta',userId:user.id,role:grantRole,status:'active' };
  let created = null, audited = 0, authorizations = 0;
  const record = values => ({ ...values,toJSON() { const {toJSON,update,...data} = this; return {...data}; },async update(changes) { Object.assign(this,changes); return this; } });
  const assignment = existing ? record({id:'assignment',eventId:event.id,userId:user.id,accessScope:'venue',venueAccessId:grant.id,status:'active',commissionBps:0,...existing}) : null;
  const models = {
    Event:{findByPk:async () => event,sequelize:{transaction:async (_,work) => work(transaction)}},User:{findByPk:async () => user},
    Organization:{findByPk:async () => ({id:'org',status:'active'})},Location:{findByPk:async () => ({id:'beta'})},OrganizationVenue:{findOne:async () => ({organizationId:'org',locationId:'beta'})},
    OrganizationOwner:{findOne:async () => null,findAll:async () => []},OrganizationEmployee:{findOne:async () => null,findAll:async () => []},OrgAffiliate:{findOne:async () => null,findAll:async () => []},
    VenueAccess:{findOne:async ({where}) => grantCurrent && where.locationId === grant.locationId ? grant : null,findAll:async ({where}) => grantCurrent && where.locationId === grant.locationId ? [grant] : []},
    EventAffiliate:{findOne:async () => assignment,create:async values => { created = record({id:'new-assignment',...values}); return created; }},
    AuditLog:{create:async () => { audited += 1; return {id:'audit'}; }},
  };
  const permissions = {assertManageEvent:async (actor,eventId,tx) => { assert.equal(actor,'actor'); assert.equal(eventId,event.id); assert.equal(tx,transaction); authorizations += 1; }};
  const service = createEventWorkspaceService({models,permissions,now:() => new Date('2030-10-01')});
  return {service,assignment,get created() {return created;},get audited() {return audited;},get authorizations() {return authorizations;}};
}

test('first event terms for a current venue employee or promoter retain exact venue scope', async () => {
  for (const grantRole of ['employee','promoter']) {
    const f = fixture({grantRole});
    await f.service.savePerson('actor','event',{userId:'recipient',commissionBps:500,status:'active'});
    assert.equal(f.created.accessScope,'venue'); assert.equal(f.created.venueAccessId,'venue-grant');
    assert.equal(f.created.orgAffiliateId,null); assert.equal(f.created.commissionBps,500);
    assert.equal(f.authorizations,1); assert.equal(f.audited,1);
  }
});

test('wrong-venue and revoked grants cannot create or revive event terms through ordinary edits', async () => {
  for (const options of [{wrongVenue:true},{grantCurrent:false},{grantCurrent:false,existing:{}},{grantCurrent:false,existing:{status:'inactive'}}]) {
    const f = fixture(options);
    await assert.rejects(f.service.savePerson('actor','event',{userId:'recipient',commissionBps:500,status:'active'}),{code:'FORBIDDEN'});
    assert.equal(f.created,null); assert.equal(f.audited,0);
    if (f.assignment) assert.equal(f.assignment.accessScope,'venue');
  }
});

test('an authorized explicit standalone regrant clears a revoked venue binding without replacing attribution identity', async () => {
  const f = fixture({grantCurrent:false,existing:{status:'inactive'}});
  await f.service.savePerson('actor','event',{userId:'recipient',commissionBps:700,status:'active'},{legacyCreate:true});
  assert.equal(f.assignment.id,'assignment'); assert.equal(f.assignment.accessScope,'event'); assert.equal(f.assignment.venueAccessId,null);
  assert.equal(f.assignment.status,'active'); assert.equal(f.authorizations,1); assert.equal(f.audited,1);
});
