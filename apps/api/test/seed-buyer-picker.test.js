const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeedBuyerPicker } = require('../src/db/seed-buyer-picker');
test('seed buyer selection ignores guestlists, allows same-event purchases and grows a busy pool', async () => {
  const event = id => ({id, startsAt:'2026-10-01T22:00:00-04:00', endsAt:'2026-10-02T02:00:00-04:00'});
  const created = [], credentials = [];
  const models = {
    Event: {}, Order:{findAll:async()=>[{buyerUserId:'one',event:event('a')}]},
    GuestlistEntry:{findAll:()=>{throw new Error('Guestlists must not influence purchase selection');}},
    User:{count:async()=>0,create:async data=>{const user={...data,id:'new'};created.push(user);return user;}},
    UserCredential:{create:async data=>credentials.push(data)},
  };
  const pick = await createSeedBuyerPicker(models,[{id:'one'},{id:'two'}],'TestPassword!2026');
  assert.equal((await pick(0,event('a'))).id,'one');
  assert.equal((await pick(0,event('b'))).id,'two');
  assert.equal((await pick(0,event('c'))).id,'new');
  assert.equal(created.length,1);
  assert.equal(credentials.length,1);
  assert.equal((await pick(0,event('c'))).id,'new');
});
