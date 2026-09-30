const { Transaction, QueryTypes } = require('sequelize');

// A database-wide readers/writer fence for the authorization graph. Ordinary
// mutations share it (they remain concurrent); access/lifecycle changes take it
// exclusively. Acquire BEFORE reading authority or locking any domain rows.
// Unlike process-local mutexes, this works across API instances and workers.
const AUTHORIZATION_FENCE = [1313428564, 1];
const guarded = new WeakMap();
async function authorizationFence(sequelize, transaction, accessChange = false) {
  if (typeof sequelize.query !== 'function') return;
  const held = guarded.get(transaction);
  if (held !== undefined) {
    if (accessChange && !held) throw new Error('Cannot upgrade an authorization fence; start an access-change transaction');
    return;
  }
  // Narrow unit fixtures have no SQL connection. Real Sequelize runtimes do.
  await sequelize.query(
    `SELECT pg_advisory_xact_lock${accessChange ? '' : '_shared'}(:namespace, :key)`,
    { replacements: { namespace: AUTHORIZATION_FENCE[0], key: AUTHORIZATION_FENCE[1] }, transaction, type: QueryTypes.SELECT },
  );
  guarded.set(transaction, accessChange);
}
async function mutationTransaction(sequelize, work, { accessChange = false } = {}) {
  // READ COMMITTED sees revocations committed while waiting for the fence.
  // Inventory/capacity/idempotency are protected by explicit domain row locks.
  return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
    await authorizationFence(sequelize, transaction, accessChange);
    return work(transaction);
  });
}
module.exports = { mutationTransaction, authorizationFence, AUTHORIZATION_FENCE };
