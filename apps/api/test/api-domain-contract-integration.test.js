const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { getConfig } = require('../src/config');
const { createSequelize } = require('../src/db/sequelize');
const { initModels } = require('../src/db/models');
const { createApp } = require('../src/app');
const { contractFor } = require('../src/http/api-contract');
const { mutationTransaction, AUTHORIZATION_FENCE } = require('../src/services/mutation-transaction');

function validateResponse(method, path, response) {
  const contract = contractFor({ method, path, authenticated: true });
  const schema = contract.responseSchemas[response.status];
  assert.ok(schema, `Undocumented ${response.status} response for ${method} ${path}`);
  assert.equal(schema.safeParse(response.body).success, true, JSON.stringify(schema.safeParse(response.body).error));
}
function gate() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

test('domain HTTP contracts and legacy/new authorization share the same database fence', { timeout: 30000 }, async (t) => {
  assertManagedTestDatabase();
  const config = getConfig();
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  const app = createApp({ sequelize, models, config });
  const owner = randomUUID(), manager = randomUUID(), customer = randomUUID(), org = randomUUID();
  const api = (method, path, userId = manager) => request(app)[method](`/api${path}`).set('x-user-id', userId);
  try {
    await models.User.bulkCreate([owner, manager, customer].map((id) => ({ id, email: `${id}@offline.nitewide.test`, displayName: 'Domain contract fixture' })));
    const venue = await models.Location.create({ name: 'Fixture venue', city: 'Orlando', region: 'FL', countryCode: 'US', timezone: 'America/New_York', addressLine1: '1 Fixture St', privacy: 'public' });
    await models.Organization.create({ id: org, name: 'Contract fixture', slug: `contract-${org}`, locationId: venue.id });
    await models.OrganizationVenue.findOrCreate({ where: { organizationId: org, locationId: venue.id } });
    await models.OrganizationOwner.bulkCreate([{ organizationId: org, userId: owner, role: 'owner' }, { organizationId: org, userId: manager, role: 'admin' }]);
    const input = { organizationId: org, title: 'Domain contract event', slug: `contract-${randomUUID()}`, startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 172800000).toISOString(), status: 'published', guestlistCapacity: 20 };
    const legacy = await api('post', '/events').send(input).expect(201);
    validateResponse('post', '/events', legacy);
    const eventId = legacy.body.data.id;
    const editor = { ...input, slug: `contract-${randomUUID()}`, organizationId: org, locationId: venue.id, summary: '', description: '', capacity: 100, isDiscoverable: false, offerings: [] };
    const modern = await api('post', '/business/events').send(editor).expect(201);
    validateResponse('post', '/business/events', modern);
    const tier = await api('post', `/events/${eventId}/offerings`).send({ name: 'General Admission', priceCents: 2500, quantityTotal: 20 }).expect(201);
    validateResponse('post', '/events/:eventId/offerings', tier);
    const purchase = await api('post', '/orders', customer).send({ eventId, idempotencyKey: randomUUID(), items: [{ offeringId: tier.body.data.id, quantity: 2 }],
      payment: { provider: 'demo', status: 'succeeded', reference: randomUUID() } }).expect(201);
    validateResponse('post', '/orders', purchase);
    const guestlist = await api('post', `/events/${eventId}/guestlist`, customer).send({ partySize: 2 }).expect(202);
    validateResponse('post', '/events/:eventId/guestlist', guestlist);
    const approved = await api('post', `/business/events/${eventId}/guestlist/${guestlist.body.data.entry.id}/decision`).send({ decision: 'approve' }).expect(200);
    validateResponse('post', '/business/events/:eventId/guestlist/:entryId/decision', approved);
    const offeringCount = await models.Offering.count();
    await t.test('admissions projection and legacy guestlist aggregates match their wire contracts', async () => {
      const response = await api('get', '/business/admissions/events').expect(200);
      validateResponse('get', '/business/admissions/events', response);
      const settings = await api('get', `/business/events/${eventId}/guestlist-settings`).expect(200);
      validateResponse('get', '/business/events/:eventId/guestlist-settings', settings);
      assert.equal(settings.body.data.direct.used, 2);
    });
    await t.test('both creation paths audit exactly once and preserve their public shape', async () => {
      assert.equal(await models.AuditLog.count({ where: { action: 'event.created' } }), 2);
      assert.equal(legacy.body.data.slug, input.slug);
      assert.equal(legacy.body.data.creatorUserId, manager);
      assert.equal(modern.body.data.creatorUserId, manager);
    });
    await t.test('discovery, report pages and summary satisfy the executable response contract', async () => {
      const discovered = await api('get', `/events/${eventId}`, customer).expect(200);
      validateResponse('get', '/events/:eventId', discovered);
      for (const table of ['regions', 'venues', 'events', 'offerings', 'team', 'customers']) {
        const response = await api('get', `/business/reports/${table}`).query({ eventId, pageSize: 1, sort: 'sales_desc' }).expect(200);
        validateResponse('get', '/business/reports/:table', response);
        assert.ok(response.body.data.items.length <= 1);
      }
      const summary = await api('get', '/business/reports/summary').query({ eventId }).expect(200);
      validateResponse('get', '/business/reports/summary', summary);
      assert.equal(summary.body.data.summary.salesCents, 5000);
      const csv = await api('get', '/business/reports/export.csv').query({ eventId, exportTable: 'customers' }).expect(200).expect('Content-Type', /text\/csv/);
      assert.match(csv.text, /Domain contract fixture/);
    });
    await t.test('malformed params and unauthorized access return structured failures', async () => {
      await api('get', '/business/events/not-a-uuid/summary').expect(422);
      await api('get', `/business/events/${eventId}/summary`, customer).expect(404);
      const unsupported = await api('get', '/business/reports/regions').query({ sort: 'commission_desc' }).expect(400);
      assert.equal(unsupported.body.error.code, 'UNSUPPORTED_REPORT_SORT');
    });
    await t.test('committed removal denies both API generations without writes or audits', async () => {
      const entered = gate(), release = gate();
      const removing = mutationTransaction(sequelize, async (transaction) => {
        const membership = await models.OrganizationOwner.unscoped().findOne({ where: { organizationId: org, userId: manager }, transaction });
        await membership.update({ lifecycleState: 'archived' }, { transaction });
        entered.resolve(); await release.promise;
      }, { accessChange: true });
      await entered.promise;
      const oldMutation = api('post', `/events/${eventId}/offerings`).send({ name: 'Blocked legacy tier', priceCents: 2500, quantityTotal: 20 }).then((response) => response);
      const newMutation = api('put', `/business/events/${modern.body.data.id}`).send({ ...editor, version: modern.body.data.version }).then((response) => response);
      try {
        const deadline = Date.now() + 5000;
        let waiting = 0;
        while (waiting < 2 && Date.now() < deadline) {
          const [row] = await sequelize.query("SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND classid=:namespace AND objid=:key AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())", { replacements: { namespace: AUTHORIZATION_FENCE[0], key: AUTHORIZATION_FENCE[1] }, type: QueryTypes.SELECT });
          waiting = row.count;
          if (waiting < 2) await new Promise((done) => setTimeout(done, 10));
        }
        assert.equal(waiting, 2, 'Both write generations wait on the authorization fence');
      } finally { release.resolve(); }
      await removing;
      const result = await Promise.all([oldMutation, newMutation]);
      assert.deepEqual(result.map((response) => response.status), [403, 403]);
      assert.equal(await models.Offering.count(), offeringCount);
      assert.equal(await models.AuditLog.count({ where: { action: 'event.created' } }), 2);
      assert.equal(await models.AuditLog.count({ where: { action: 'event.updated' } }), 0);
    });
  } finally {
    await app.locals.reportExports?.stop();
    await sequelize.close();
  }
});
