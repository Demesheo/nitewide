const { canBook } = require('./seed-booking-policy');
const { createPasswordRecord } = require('../services/auth-service');
// Expands the demo customer pool instead of booking one customer into two venues.
async function createSeedBuyerPicker(models, customers, password) {
  const pool = [...customers];
  const orders = await models.Order.findAll({ where: { status: 'paid' }, include: [{ model: models.Event, as: 'event' }] });
  const booked = new Map();
  for (const order of orders) {
    if (!booked.has(order.buyerUserId)) booked.set(order.buyerUserId, []);
    booked.get(order.buyerUserId).push(order.event);
  }
  return async (preferredIndex, event) => {
    let buyer;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(preferredIndex + offset) % pool.length];
      if (canBook(booked.get(candidate.id) || [], event)) { buyer = candidate; break; }
    }
    if (!buyer) {
      const first = ['Adrian','Bianca','Cameron','Diana','Emerson','Felix','Gabriela','Hugo','Imani','Javier','Keira','Luca'];
      const last = ['Adams','Bennett','Chen','Diaz','Ellis','Foster','Garcia','Hayes','Irwin','Jones','Kim','Lopez'];
      let index = pool.length;
      let email;
      do { email = `orlando.customer${++index}@nitewide.test`; } while (await models.User.count({ where: { email } }));
      buyer = await models.User.create({ email, displayName: `${first[index % first.length]} ${last[Math.floor(index / first.length) % last.length]}` });
      await models.UserCredential.create({ userId: buyer.id, ...(await createPasswordRecord(password)) });
      pool.push(buyer);
    }
    if (!booked.has(buyer.id)) booked.set(buyer.id, []);
    booked.get(buyer.id).push(event);
    return buyer;
  };
}
module.exports = { createSeedBuyerPicker };
