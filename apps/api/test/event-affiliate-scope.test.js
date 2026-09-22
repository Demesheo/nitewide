const test = require('node:test');
const assert = require('node:assert/strict');
const { activeEventAffiliates } = require('../src/services/event-affiliate-scope');

test('former staff and leaders cannot reuse automatic assignments as business access', async () => {
  const models = { Event: { findAll: async () => [{id:'event',organizationId:'venue'}] } };
  const assignments = [
    {id:'staff',eventId:'event',code:'STAFFEV-test'},
    {id:'leader',eventId:'event',code:'LEADEV-test'},
    {id:'promoter',eventId:'event',code:'NW-test'},
  ];
  assert.deepEqual((await activeEventAffiliates(models,assignments,[],[])).map((item)=>item.id),['promoter']);
  assert.deepEqual((await activeEventAffiliates(models,assignments,[],[{organizationId:'venue'}])).map((item)=>item.id),['staff','promoter']);
  assert.deepEqual((await activeEventAffiliates(models,assignments,[{organizationId:'venue'}],[])).map((item)=>item.id),['leader','promoter']);
});
