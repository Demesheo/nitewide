const test = require('node:test');
const assert = require('node:assert/strict');
const { overlaps } = require('../src/db/seed-booking-policy');
const { stableId, assertLocalDemoDatabase } = require('../src/db/posh-importer');
const snapshot = require('../src/db/fixtures/posh-orlando-2026-09-22');

// Read-only contract for a local database after db:seed:orlando --apply.
test('Orlando fixtures have non-overlapping paid bookings and available event-only promoters', { skip: process.env.RUN_ORLANDO_SEED_TESTS !== '1' }, async () => {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const config = require('../src/config').getConfig();
  assertLocalDemoDatabase(config);
  const sequelize = require('../src/db/sequelize').createSequelize(config);
  const m = require('../src/db/models').initModels(sequelize);
  try {
    const orders = await m.Order.findAll({ where:{status:'paid'}, include:[{model:m.Event,as:'event'}] });
    for (const [i,order] of orders.entries()) {
      assert.ok(!orders.slice(i+1).some(other=>other.buyerUserId===order.buyerUserId && other.eventId!==order.eventId && overlaps(order.event,other.event)),`Overlapping purchase for ${order.id}`);
    }
    const imported = await m.Event.findAll({where:{id:snapshot.events.map(e=>stableId(e.sourceUrl))}});
    assert.ok(imported.length>0,'Run the Orlando snapshot import first');
    const sources = new Map(snapshot.events.map(e=>[stableId(e.sourceUrl),e]));
    for (const [i,event] of imported.entries()) assert.ok(!imported.slice(i+1).some(other=>sources.get(event.id).venueSlug===sources.get(other.id).venueSlug && overlaps(event,other)));
    const assignments = await m.EventAffiliate.findAll({where:{status:'active'},include:[{model:m.Event,as:'event'}]});
    for(const event of imported.filter(e=>snapshot.venues[sources.get(e.id).venueSlug].availablePromotersOnly)) {
      const assigned = assignments.filter(a=>a.eventId===event.id && a.commissionBps>0);
      assert.equal(assigned.length,2);
      for(const ref of assigned) assert.ok(!assignments.some(other=>other.userId===ref.userId && other.eventId!==ref.eventId && other.event.status!=='cancelled' && overlaps(other.event,event)));
    }
    const proper=await m.Organization.findOne({where:{slug:'proper'}}),room=await m.Organization.findOne({where:{slug:'room-22'}});
    assert.equal(room.status,'closed');
    assert.equal(await m.Event.count({where:{organizationId:room.id}}),0);
    const roomLocations=await m.Location.findAll({where:{name:'Room 22'}});
    const roomEvents=await m.Event.findAll({where:{locationId:roomLocations.map(l=>l.id)}});
    assert.ok(roomEvents.length>0);
    assert.ok(roomEvents.every(e=>e.organizationId===proper.id));
    for(const [slug,venue] of Object.entries(snapshot.venues).filter(([,v])=>v.provision)) {
      const org=await m.Organization.findOne({where:{slug}});
      const managers=await m.OrganizationOwner.count({where:{organizationId:org.id,role:'admin'}});
      const employees=await m.OrganizationEmployee.count({where:{organizationId:org.id,status:'active'}});
      assert.ok(managers>=1&&managers<=3,venue.name);
      assert.ok(employees>=9&&employees<=12,venue.name);
    }
  } finally { await sequelize.close(); }
});
