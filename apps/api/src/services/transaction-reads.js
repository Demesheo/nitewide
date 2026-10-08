// Sequelize's findAndCountAll dispatches both queries concurrently. A transaction
// owns one PostgreSQL client, so preserve its result semantics with serial reads.
async function findAndCountSequential(model, options) {
  if (!options?.transaction) throw new Error('Sequential transaction reads require a transaction');
  const count = await model.count({ ...options, attributes: undefined });
  const rows = await model.findAll(options);
  return { count, rows: count === 0 ? [] : rows };
}

module.exports = { findAndCountSequential };
