const test = require('node:test');
const assert = require('node:assert/strict');
const { activeEventAffiliates } = require('../src/services/event-affiliate-scope');

test('organization assignments require current membership and survive permitted same-org role changes', async () => {
  const models = { Event: { findAll: async () => [{id:'event',organizationId:'venue'}] } };
  const assignments = [
    {id:'staff',eventId:'event',code:'STAFFEV-test'},
    {id:'leader',eventId:'event',code:'LEADEV-test'},
    {id:'promoter',eventId:'event',code:'NW-test'},
  ];
  assert.deepEqual((await activeEventAffiliates(models,assignments,[],[])).map((item)=>item.id),['promoter']);
  assert.deepEqual((await activeEventAffiliates(models,assignments,[],[{organizationId:'venue'}])).map((item)=>item.id),['staff','leader','promoter']);
  assert.deepEqual((await activeEventAffiliates(models,assignments,[{organizationId:'venue'}],[])).map((item)=>item.id),['staff','leader','promoter']);
});

test('standalone assignments also require a current period before the no-organization fast path', async () => {
  const assignments = [{id:'active'},{id:'expired',endsAt:new Date(Date.now()-1000)},{id:'future',startsAt:new Date(Date.now()+86400000)}];
  assert.deepEqual((await activeEventAffiliates({},assignments,[],[])).map(item => item.id),['active']);
});
