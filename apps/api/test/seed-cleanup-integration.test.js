const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { cleanSeedPurchases } = require('../src/db/clean-seed-purchases');

test('seed cleanup preserves overlapping guestlists and mock purchases, balances inventory and archives removed graphs', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  const config = require('../src/config').getConfig();
  const sequelize = require('../src/db/sequelize').createSequelize(config);
  const m = require('../src/db/models').initModels(sequelize);
  const tx = await sequelize.transaction();
  const opts = { transaction: tx };
  try {
    const users = await m.User.bulkCreate([1,2].map(() => ({ id: randomUUID(), email: `${randomUUID()}@integration.nitewide.test`, displayName: 'Seed cleanup fixture' })), opts);
    const events = await m.Event.bulkCreate([1,2].map(n => ({ creatorUserId: users[0].id, title: `Fixture ${n}`, slug: `fixture-${randomUUID()}`, startsAt: '2026-10-01T22:00:00-04:00', endsAt: '2026-10-02T02:00:00-04:00', status: 'published' })), opts);
    const offers = await m.Offering.bulkCreate(events.map(event => ({ eventId:event.id,name:'GA',priceCents:1000,quantityTotal:100,quantitySold:0 })), opts);
    const orderIds = [];
    for (const [i, [buyer,eventIndex,provider]] of [[0,0,'seed'],[0,0,'seed'],[0,1,'seed'],[1,1,'demo'],[1,0,'seed']].entries()) {
      const order = await m.Order.create({ buyerUserId:users[buyer].id,eventId:events[eventIndex].id,status:'paid',idempotencyKey:randomUUID(),paidAt:new Date(Date.UTC(2026,8,20,i)),subtotalCents:1000,totalCents:1154 },opts);
      orderIds.push(order.id);
      const item = await m.OrderItem.create({orderId:order.id,offeringId:offers[eventIndex].id,nameSnapshot:'GA',kindSnapshot:'ticket',quantity:1,entriesPerUnitSnapshot:1,unitPriceCents:1000,lineTotalCents:1000},opts);
      const ticket = await m.Ticket.create({eventId:order.eventId,orderItemId:item.id,holderUserId:order.buyerUserId,qrTokenHash:createHash('sha256').update(randomUUID()).digest('hex')},opts);
      await m.Payment.create({orderId:order.id,provider,providerReference:randomUUID(),status:'succeeded',amountCents:1154},opts);
      await m.AffiliateAttribution.create({orderId:order.id,eventId:order.eventId,userId:order.buyerUserId,action:'purchase',occurredAt:new Date()},opts);
      await offers[eventIndex].increment('quantitySold',{...opts,by:1});
      if (i===2) await m.CheckIn.create({ticketId:ticket.id,eventId:order.eventId,checkedInByUserId:users[0].id},opts);
    }
    const guests = await m.GuestlistEntry.bulkCreate(events.map(e=>({eventId:e.id,userId:users[0].id,source:'event',status:'confirmed',partySize:2})),opts);
    const before = guests.map(g=>g.toJSON());
    const scoped = { sequelize:{transaction:callback=>callback(tx),query:sequelize.query.bind(sequelize)},models:m,config,buyerUserIds:users.map(u=>u.id) };
    const dry = await cleanSeedPurchases(scoped);
    assert.equal(dry.remove,2);
    assert.equal(await m.Order.count({where:{id:orderIds},...opts}),5);
    const result = await cleanSeedPurchases({...scoped,apply:true});
    assert.deepEqual(result.removedOrderIds.sort(),[orderIds[2],orderIds[4]].sort());
    assert.equal(await m.Order.count({where:{id:orderIds},...opts}),3);
    assert.equal(await m.Order.count({where:{id:orderIds[3]},...opts}),1,'Browser mock purchase preserved');
    for(const [i,offer] of offers.entries()) assert.equal((await offer.reload(opts)).quantitySold,i===0?2:1);
    assert.deepEqual((await m.GuestlistEntry.findAll({where:{id:guests.map(g=>g.id)},order:[['eventId','ASC']],...opts})).map(g=>g.toJSON()),before.sort((a,b)=>a.eventId.localeCompare(b.eventId)));
    const archives = await m.AuditLog.findAll({where:{entityId:result.removedOrderIds,action:'order.seed_overlap_removed'},...opts});
    assert.equal(archives.length,2);
    assert.ok(archives.every(a=>a.before.items.length===1&&a.before.tickets.length===1&&a.before.payments.length===1));
    assert.equal((await cleanSeedPurchases({...scoped,apply:true})).remove,0,'Rerun is idempotent');
  } finally { await tx.rollback(); await sequelize.close(); }
});
