const test = require('node:test');
const assert = require('node:assert/strict');
const { mutationTransaction, authorizationFence } = require('../src/services/mutation-transaction');
const { findAndCountSequential } = require('../src/services/transaction-reads');
const { canonicalCart, fingerprint } = require('../src/services/checkout-service');

test('mutation begins at READ COMMITTED and acquires the fence before application work', async () => {
  const calls = [], tx = {};
  const sequelize = {
    transaction: async (options, work) => { assert.equal(options.isolationLevel, 'READ COMMITTED'); return work(tx); },
    query: async (sql, options) => { assert.equal(options.transaction, tx); calls.push(sql); },
  };
  assert.equal(await mutationTransaction(sequelize, async (transaction) => {
    assert.equal(transaction, tx); calls.push('authorize then write'); return 'saved';
  }), 'saved');
  assert.match(calls[0], /pg_advisory_xact_lock_shared/);
  assert.equal(calls[1], 'authorize then write');
});

test('access changes take an exclusive fence and nested shared claims do not acquire it twice', async () => {
  const sql = [], tx = {};
  const sequelize = { transaction: async (_options, work) => work(tx), query: async (query) => sql.push(query) };
  await mutationTransaction(sequelize, async (transaction) => {
    await authorizationFence(sequelize, transaction);
  }, { accessChange: true });
  assert.equal(sql.length, 1);
  assert.match(sql[0], /pg_advisory_xact_lock\(/);
});

test('shared to exclusive upgrades fail before an unsafe lock upgrade', async () => {
  const tx = {}, sequelize = { query: async () => {} };
  await authorizationFence(sequelize, tx);
  await assert.rejects(authorizationFence(sequelize, tx, true), /Cannot upgrade/);
});

test('transaction page count and rows run serially while retaining Sequelize result semantics', async () => {
  const transaction = {}, row = { id: 'row' };
  for (const count of [0, 3, [{ kind: 'ticket', count: 3 }]]) {
    const calls = [];
    let counting = false;
    const options = { transaction, where: { active: true }, attributes: ['id'], limit: 2, offset: 2, order: [['id', 'ASC']] };
    const model = {
      async count(input) {
        assert.equal(input.transaction, transaction);
        assert.deepEqual(input, { ...options, attributes: undefined });
        counting = true; calls.push('count');
        await Promise.resolve();
        counting = false; return count;
      },
      async findAll(input) {
        assert.equal(counting, false, 'rows must wait until the count query completes');
        assert.equal(input, options); calls.push('rows'); return [row];
      },
    };
    assert.deepEqual(await findAndCountSequential(model, options), { count, rows: count === 0 ? [] : [row] });
    assert.deepEqual(calls, ['count', 'rows']);
    assert.deepEqual(options.attributes, ['id'], 'count preparation does not change the row projection');
  }
  await assert.rejects(findAndCountSequential({}, {}), /require a transaction/);
});

test('cart fingerprint merges duplicates and sorts items, but distinguishes event, quantities and referral', () => {
  const input = { eventId: 'event', items: [{ offeringId: 'b', quantity: 1 }, { offeringId: 'a', quantity: 1 }, { offeringId: 'a', quantity: 2 }] };
  assert.equal(fingerprint(input), fingerprint({ ...input, items: [{ offeringId: 'a', quantity: 3 }, { offeringId: 'b', quantity: 1 }] }));
  for (const changed of [{ ...input, eventId: 'other' }, { ...input, affiliateCode: 'other' }, { ...input, items: [{ offeringId: 'a', quantity: 1 }] }])
    assert.notEqual(fingerprint(input), fingerprint(changed));
  assert.throws(() => canonicalCart('event', [{ offeringId: 'a', quantity: -1 }]), { code: 'INVALID_QUANTITY' });
  assert.throws(() => canonicalCart('event', [{ offeringId: 'a', quantity: 0.5 }]), { code: 'INVALID_QUANTITY' });
  assert.throws(() => canonicalCart('event', []), { code: 'EMPTY_ORDER' });
});
