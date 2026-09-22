require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
const { assertLocalDemoDatabase } = require('./posh-importer');
const { planPurchaseCleanup } = require('./seed-booking-policy');

async function cleanSeedPurchases({ sequelize, models: m, config, apply = false, buyerUserIds }) {
  assertLocalDemoDatabase(config);
  return sequelize.transaction(async transaction => {
    await sequelize.query('SELECT pg_advisory_xact_lock(7210922)', { transaction });
    const orders = await m.Order.findAll({ where: { status: 'paid', ...(buyerUserIds ? { buyerUserId: buyerUserIds } : {}) }, order: [['paidAt', 'ASC'], ['id', 'ASC']], transaction });
    const events = await m.Event.findAll({ where: { id: [...new Set(orders.map(o => o.eventId))] }, transaction });
    const payments = await m.Payment.findAll({ where: { orderId: orders.map(o => o.id) }, transaction });
    const eventById = new Map(events.map(e => [e.id, e.toJSON()]));
    const input = orders.map(o => {
      const ps = payments.filter(p => p.orderId === o.id);
      return { ...o.toJSON(), event: eventById.get(o.eventId), seed: ps.length > 0 && ps.every(p => p.provider === 'seed') };
    });
    const plan = planPurchaseCleanup(input);
    const report = { mode: apply ? 'apply' : 'dry-run', paidOrders: orders.length, remove: plan.removed.length, retained: plan.kept.length,
      guestlistsChanged: 0, removedOrderIds: plan.removed.map(({order}) => order.id), auditAction: 'order.seed_overlap_removed' };
    if (!apply) return report;
    for (const { order, keptOrderId } of plan.removed) {
      const items = await m.OrderItem.findAll({ where: { orderId: order.id }, transaction });
      const tickets = await m.Ticket.findAll({ where: { orderItemId: items.map(i => i.id) }, transaction });
      const checkIns = await m.CheckIn.findAll({ where: { ticketId: tickets.map(t => t.id) }, transaction });
      const attributions = await m.AffiliateAttribution.findAll({ where: { orderId: order.id }, transaction });
      const notifications = await m.Notification.findAll({ where: { 'metadata.orderId': order.id }, transaction });
      const plain = rows => rows.map(row => row.toJSON());
      await m.AuditLog.create({ organizationId: order.event.organizationId, entityType: 'Order', entityId: order.id, action: report.auditAction,
        before: { order: orders.find(o => o.id === order.id).toJSON(), items: plain(items), tickets: plain(tickets), checkIns: plain(checkIns), payments: plain(payments.filter(p => p.orderId === order.id)), attributions: plain(attributions), notifications: plain(notifications) },
        after: { keptOrderId, reason: 'Local seed purchase overlaps another event; guestlists unchanged' } }, { transaction });
      for (const item of items) {
        const offering = await m.Offering.findByPk(item.offeringId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!offering || offering.quantitySold < item.quantity) throw new Error(`Inconsistent inventory for ${item.offeringId}; cleanup rolled back`);
        await offering.decrement('quantitySold', { by: item.quantity, transaction });
      }
      await m.CheckIn.destroy({ where: { id: checkIns.map(c => c.id) }, transaction });
      await m.Notification.destroy({ where: { id: notifications.map(n => n.id) }, transaction });
      await m.AffiliateAttribution.destroy({ where: { orderId: order.id }, transaction });
      await m.Ticket.destroy({ where: { id: tickets.map(t => t.id) }, transaction });
      await m.Payment.destroy({ where: { orderId: order.id }, transaction });
      await m.OrderItem.destroy({ where: { orderId: order.id }, transaction });
      await m.Order.destroy({ where: { id: order.id }, transaction });
    }
    return report;
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--apply','--dry-run'].includes(a)) || args.length > 1) throw new Error('Use --dry-run or --apply');
  const config = require('../config').getConfig();
  const sequelize = require('./sequelize').createSequelize(config);
  try { console.log(JSON.stringify(await cleanSeedPurchases({ sequelize, models: require('./models').initModels(sequelize), config, apply: args.includes('--apply') }), null, 2)); }
  finally { await sequelize.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { cleanSeedPurchases };
