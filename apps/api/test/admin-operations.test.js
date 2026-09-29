const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const { operationsQuery } = require('../src/http/admin-schemas');
const { createAdminService } = require('../src/services/admin-service');
const { createPermissionService } = require('../src/services/permission-service');

function makeService({ kind = 'failed_payments', rows = [], count = rows.length, currentUser = { isInternalAdmin: true } } = {}) {
  const calls = {};
  const model = (name) => ({
    count: async ({ where }) => {
      calls[`${name}.count`] = where;
      return name === 'Payment' ? 7 : name === 'GuestlistEntry' ? 4 : 3;
    },
    findAndCountAll: async (query) => {
      calls[`${name}.findAndCountAll`] = query;
      return { count, rows };
    },
  });
  const models = {
    User: { findByPk: async () => currentUser },
    Payment: model('Payment'),
    GuestlistEntry: model('GuestlistEntry'),
    Organization: model('Organization'),
    Event: {},
  };
  const permissions = createPermissionService(models);
  const service = createAdminService({ models, permissions });
  return { service, calls, kind };
}

test('operations query defaults are stable and invalid filters are rejected', () => {
  assert.deepEqual(operationsQuery.parse({}), {
    kind: 'failed_payments', page: 1, pageSize: 25, search: '',
  });
  assert.equal(operationsQuery.parse({ kind: 'pending_guestlist', page: '4', pageSize: '100', search: '  Eden  ' }).search, 'Eden');
  for (const query of [
    { kind: 'orders' },
    { page: '0' },
    { page: '1000001' },
    { pageSize: '101' },
    { search: 'x'.repeat(121) },
  ]) assert.equal(operationsQuery.safeParse(query).success, false, JSON.stringify(query));
});

test('operations returns global counts and paginates the selected failed payment attempts', async () => {
  const paidOrderAfterRetry = {
    id: 'payment-failed-attempt', orderId: 'order-retried', provider: 'development',
    status: 'failed', amountCents: 1080, currency: 'USD', processedAt: null,
    createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
    order: {
      id: 'order-retried', status: 'paid',
      buyer: { id: 'buyer-1', displayName: 'Jordan Customer', email: 'jordan@example.test' },
      event: { id: 'event-1', title: 'Friday Sessions', organization: { id: 'org-1', name: 'Sessions' } },
    },
  };
  const { service, calls } = makeService({ rows: [paidOrderAfterRetry], count: 61 });
  const result = await service.operations('internal-admin', {
    kind: 'failed_payments', page: 3, pageSize: 25, search: '',
  });

  assert.deepEqual(result.counts, { failedPayments: 7, pendingGuestlist: 4, suspendedOrganizations: 3 });
  assert.deepEqual(result.queue, {
    kind: 'failed_payments', page: 3, pageSize: 25, total: 61, items: [paidOrderAfterRetry],
  });
  const query = calls['Payment.findAndCountAll'];
  assert.deepEqual(query.where, { status: 'failed' });
  assert.equal(query.limit, 25);
  assert.equal(query.offset, 50);
  assert.deepEqual(query.order, [['createdAt', 'DESC'], ['id', 'DESC']]);
  assert.equal(query.distinct, true);
  assert.equal(result.queue.items[0].status, 'failed');
  assert.equal(result.queue.items[0].order.status, 'paid');
});

test('operations search filters the selected queue and permits nullable joined records', async () => {
  const rows = [{ id: 'guest-1', status: 'pending', event: null, user: null }];
  const { service, calls } = makeService({ rows, count: 1 });
  const result = await service.operations('internal-admin', {
    kind: 'pending_guestlist', page: 1, pageSize: 25, search: 'jordan@example.test',
  });

  assert.deepEqual(result.queue.items, rows);
  const query = calls['GuestlistEntry.findAndCountAll'];
  assert.equal(query.where.status, 'pending');
  assert.ok(Array.isArray(query.where[Op.or]));
  assert.ok(query.where[Op.or].some((term) => term['$user.display_name$']?.[Op.iLike] === '%jordan@example.test%'));
  assert.ok(query.where[Op.or].some((term) => term['$user.email$']?.[Op.iLike] === '%jordan@example.test%'));
  assert.equal(query.include[0].required, false);
  assert.equal(query.include[1].required, false);
  assert.equal(query.subQuery, false);
});

test('operations search escapes SQL wildcard characters and matches exact UUID references', async () => {
  const { service, calls } = makeService();
  const search = 'a%_b';
  await service.operations('internal-admin', {
    kind: 'failed_payments', page: 1, pageSize: 25, search,
  });
  const query = calls['Payment.findAndCountAll'];
  assert.ok(query.where[Op.or].some((term) => term.provider?.[Op.iLike] === '%a\\%\\_b%'));

  const id = '123e4567-e89b-42d3-a456-426614174000';
  const byId = makeService();
  await byId.service.operations('internal-admin', {
    kind: 'failed_payments', page: 1, pageSize: 25, search: id,
  });
  const idSearch = byId.calls['Payment.findAndCountAll'].where[Op.or];
  assert.ok(idSearch.some((term) => term.id === id));
  assert.ok(idSearch.some((term) => term.orderId === id));
});

test('operations searches suspended organizations by name and slug with global counts unchanged', async () => {
  const { service, calls } = makeService({ rows: [{ id: 'org-1', name: 'Eden', status: 'suspended' }], count: 250 });
  const result = await service.operations('internal-admin', {
    kind: 'suspended_organizations', page: 1, pageSize: 10, search: 'eden',
  });

  assert.equal(result.counts.failedPayments, 7);
  assert.equal(result.counts.pendingGuestlist, 4);
  assert.equal(result.queue.total, 250);
  assert.deepEqual(calls['Organization.findAndCountAll'].where[Op.or], [
    { name: { [Op.iLike]: '%eden%' } },
    { slug: { [Op.iLike]: '%eden%' } },
  ]);
});

test('operations denies customer and business users before querying queues', async () => {
  for (const role of ['customer', 'business owner', 'manager']) {
    const user = { isInternalAdmin: false, role };
    const { service, calls } = makeService({ currentUser: user });
    await assert.rejects(
      () => service.operations(role, { kind: 'failed_payments', page: 1, pageSize: 25, search: '' }),
      { code: 'FORBIDDEN' },
    );
    assert.deepEqual(calls, {});
  }
});
