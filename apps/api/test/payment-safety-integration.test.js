const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createSequelize } = require('../src/db/sequelize');
const { initModels } = require('../src/db/models');
const { createApp } = require('../src/app');
const { createCheckoutService } = require('../src/services/checkout-service');

test('paid checkout fails closed while free recovery stays buyer scoped and race safe', { timeout: 30000 }, async (t) => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const sequelize = createSequelize(config), models = initModels(sequelize);
  const buyer = randomUUID(), otherBuyer = randomUUID(), owner = randomUUID();
  try {
    await models.User.bulkCreate([buyer, otherBuyer, owner].map((id) => ({ id, displayName: 'Payment safety fixture', email: `${id}@offline.nitewide.test` })));
    const organization = await models.Organization.create({ name: 'Payment safety', slug: `payments-${randomUUID()}` });
    const event = await models.Event.create({ organizationId: organization.id, creatorUserId: owner, title: 'Payment safety', slug: `payments-${randomUUID()}`, status: 'published', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000) });
    const paid = await models.Offering.create({ eventId: event.id, name: 'Paid', priceCents: 2500, quantityTotal: 20 });
    const free = await models.Offering.create({ eventId: event.id, name: 'Free', priceCents: 0, quantityTotal: 20 });
    const checkout = createCheckoutService({ sequelize, models, environment: 'production', email: null });
    const app = createApp({ sequelize, models, config, services: { checkout } });
    const api = (method, path, userId = buyer) => { const call = request(app)[method](`/api${path}`); return userId ? call.set('x-user-id', userId) : call; };
    const input = { eventId: event.id, idempotencyKey: randomUUID(), items: [{ offeringId: paid.id, quantity: 1 }], payment: { provider: 'stripe', reference: 'pi_caller_claimed', status: 'succeeded' } };

    await t.test('fake success cannot create orders, payments, inventory, admissions, audit or outbox', async () => {
      const response = await api('post', '/orders').send(input).expect(503);
      assert.equal(response.body.error.code, 'PAYMENTS_NOT_ENABLED');
      for (const name of ['Order', 'OrderItem', 'Ticket', 'Payment', 'AffiliateAttribution', 'AuditLog', 'EmailOutbox', 'NotificationJob']) assert.equal(await models[name].count(), 0, name);
      assert.equal((await paid.reload()).quantitySold, 0);
      await api('get', `/customer/checkout-attempts/${input.idempotencyKey}`).expect(404);
    });

    const freeInput = { eventId: event.id, idempotencyKey: randomUUID(), items: [{ offeringId: free.id, quantity: 1 }] };
    let orderId;
    await t.test('two identical free requests yield one order and one admission without provider setup', async () => {
      const responses = await Promise.all([api('post', '/orders').send(freeInput), api('post', '/orders').send(freeInput)]);
      assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 201]);
      orderId = responses[0].body.data.order.id;
      assert.equal(responses[1].body.data.order.id, orderId);
      assert.equal(await models.Order.count(), 1);
      assert.equal(await models.Ticket.count(), 1);
      assert.equal(await models.NotificationJob.count(), 1);
      assert.equal((await free.reload()).quantitySold, 1);
      const payment = await models.Payment.findOne();
      assert.equal(payment.provider, 'free');
      assert.equal(payment.amountCents, 0);
    });

    await t.test('recovery requires authentication, isolates the buyer and returns only identity/status', async () => {
      const path = `/customer/checkout-attempts/${freeInput.idempotencyKey}`;
      await api('get', path, null).expect(401);
      await api('get', path, otherBuyer).expect(404);
      const recovered = await api('get', path).expect(200);
      assert.deepEqual(recovered.body.data, { orderId, status: 'paid', verificationStatus: null });
      assert.equal(recovered.headers['cache-control'], 'no-store');
      await api('get', '/customer/checkout-attempts/short').expect(422);
      await api('post', '/orders').send({ ...freeInput, items: [{ offeringId: free.id, quantity: 2 }] }).expect(409);
      assert.equal(await models.Order.count(), 1);
      assert.equal((await free.reload()).quantitySold, 1);
    });
  } finally { await sequelize.close(); }
});
