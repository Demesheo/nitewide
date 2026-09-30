const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createSequelize } = require('../src/db/sequelize');
const { initModels } = require('../src/db/models');
const { mutationTransaction, AUTHORIZATION_FENCE } = require('../src/services/mutation-transaction');
const { createPermissionService } = require('../src/services/permission-service');
const { createTeamService } = require('../src/services/team-service');
const { createCheckoutService } = require('../src/services/checkout-service');

function gate() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
// Observe PostgreSQL's actual waiting lock, not a timing assumption about JS.
async function waitForFenceWaiter(sequelize) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await sequelize.query('SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype=\'advisory\' AND classid=:namespace AND objid=:key AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())',
      { replacements: { namespace: AUTHORIZATION_FENCE[0], key: AUTHORIZATION_FENCE[1] }, type: QueryTypes.SELECT });
    if (row.count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Expected a transaction to wait on the authorization fence');
}

test('real PostgreSQL orders revocation and writes, rolls back side effects, and protects checkout key reuse', { timeout: 30000 }, async (t) => {
  assertManagedTestDatabase();
  const sequelize = createSequelize({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const models = initModels(sequelize), permissions = createPermissionService(models);
  const team = createTeamService({ models, permissions });
  const ownerId = randomUUID(), managerId = randomUUID(), buyerId = randomUUID(), orgId = randomUUID();
  try {
    await models.User.bulkCreate([ownerId, managerId, buyerId].map((id) => ({ id, displayName: 'Concurrency fixture', email: `${id}@offline.nitewide.test` })));
    await models.Organization.create({ id: orgId, name: 'Concurrency fixture', slug: `qa-${orgId}` });
    await models.OrganizationOwner.bulkCreate([{ organizationId: orgId, userId: ownerId, role: 'owner' }, { organizationId: orgId, userId: managerId, role: 'admin' }]);
    const manager = () => models.OrganizationOwner.unscoped().findOne({ where: { organizationId: orgId, userId: managerId } });

    await t.test('removal committed first denies invitation and creates no audit/outbox', async () => {
      const entered = gate(), release = gate();
      const removing = mutationTransaction(sequelize, async (transaction) => {
        await (await manager()).update({ lifecycleState: 'archived' }, { transaction }); entered.resolve(); await release.promise;
      }, { accessChange: true });
      await entered.promise;
      const result = team.invite(managerId, orgId, { email: 'blocked@offline.nitewide.test', role: 'employee' }).then(() => null, (error) => error);
      try { await waitForFenceWaiter(sequelize); } finally { release.resolve(); }
      await removing;
      assert.equal((await result).code, 'FORBIDDEN');
      assert.equal(await models.TeamInvitation.count(), 0);
      assert.equal(await models.AuditLog.count(), 0);
      assert.equal(await models.EmailOutbox.count(), 0);
    });

    await t.test('authorized write commits before removal, while ordinary shared writers remain concurrent', async () => {
      await mutationTransaction(sequelize, async (transaction) => (await manager()).update({ lifecycleState: 'active' }, { transaction }), { accessChange: true });
      const entered = gate(), release = gate();
      const heldPermissions = { ...permissions, assertManageOrganization: async (...args) => {
        await permissions.assertManageOrganization(...args); entered.resolve(); await release.promise;
      } };
      const writing = createTeamService({ models, permissions: heldPermissions }).invite(managerId, orgId, { email: 'allowed@offline.nitewide.test', role: 'employee' });
      await entered.promise;
      await mutationTransaction(sequelize, async () => {}); // Must complete without waiting on the other shared writer.
      const removing = team.removeMember(ownerId, orgId, managerId);
      try { await waitForFenceWaiter(sequelize); } finally { release.resolve(); }
      const invitation = await writing;
      assert.ok(invitation.id); await removing;
      assert.equal((await manager()).lifecycleState, 'archived');
      assert.equal(await models.TeamInvitation.count(), 1);
      assert.equal(await models.AuditLog.count({ where: { action: 'team.invited' } }), 1);
      await assert.rejects(team.invite(managerId, orgId, { email: 'after@offline.nitewide.test', role: 'employee' }), { code: 'FORBIDDEN' });
    });

    await t.test('rolled-back removal releases the fence without revoking subsequent writes', async () => {
      await mutationTransaction(sequelize, async (transaction) => (await manager()).update({ lifecycleState: 'active' }, { transaction }), { accessChange: true });
      const entered = gate(), release = gate();
      const removing = mutationTransaction(sequelize, async (transaction) => {
        await (await manager()).update({ lifecycleState: 'archived' }, { transaction }); entered.resolve(); await release.promise;
        throw new Error('Rollback removal');
      }, { accessChange: true }).catch((error) => error);
      await entered.promise;
      const writing = team.invite(managerId, orgId, { email: 'after-rollback@offline.nitewide.test', role: 'employee' });
      try { await waitForFenceWaiter(sequelize); } finally { release.resolve(); }
      assert.equal((await removing).message, 'Rollback removal');
      assert.ok((await writing).id);
      assert.equal((await manager()).lifecycleState, 'active');
    });

    await t.test('a failed authorized write rolls back invitation, audit and queued email together', async () => {
      const failingEmail = { enabled: true, queue: async (message, transaction) => {
        await models.EmailOutbox.create({ templateAlias: message.template, dedupeKey: randomUUID(), recipientEmail: message.to, encryptedVariables: 'offline fixture' }, { transaction });
        throw new Error('Simulated queue failure');
      } };
      const before = await models.AuditLog.count();
      await assert.rejects(createTeamService({ models, permissions, email: failingEmail }).invite(ownerId, orgId, { email: 'rollback@offline.nitewide.test', role: 'employee' }), /Simulated queue failure/);
      assert.equal(await models.TeamInvitation.count({ where: { email: 'rollback@offline.nitewide.test' } }), 0);
      assert.equal(await models.AuditLog.count(), before);
      assert.equal(await models.EmailOutbox.count(), 0);
    });

    await t.test('same-key concurrent carts return one success and one conflict without extra inventory or tickets', async () => {
      const event = await models.Event.create({ creatorUserId: ownerId, organizationId: orgId, title: 'Concurrency', slug: `qa-${randomUUID()}`, status: 'published', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000) });
      const offering = await models.Offering.create({ eventId: event.id, name: 'Ticket', priceCents: 2500, quantityTotal: 20 });
      const checkout = createCheckoutService({ sequelize, models, email: null });
      const base = { buyerUserId: buyerId, eventId: event.id, idempotencyKey: randomUUID(), payment: { provider: 'demo', status: 'succeeded' } };
      const inputs = [1, 2].map((quantity) => ({ ...base, items: [{ offeringId: offering.id, quantity }] }));
      const results = await Promise.allSettled(inputs.map(checkout));
      const winner = results.findIndex((result) => result.status === 'fulfilled'), loser = results.find((result) => result.status === 'rejected');
      assert.ok(winner >= 0); assert.equal(loser.reason.code, 'IDEMPOTENCY_CONFLICT'); assert.equal(loser.reason.status, 409);
      assert.equal(await models.Order.count(), 1);
      assert.equal((await offering.reload()).quantitySold, inputs[winner].items[0].quantity);
      assert.equal(await models.Ticket.count(), inputs[winner].items[0].quantity);
      const replay = await checkout(inputs[winner]); assert.equal(replay.replayed, true); assert.equal(replay.order.id, results[winner].value.order.id); assert.deepEqual(replay.credentials, []);
      const secondEvent = await models.Event.create({ creatorUserId: ownerId, organizationId: orgId, title: 'Other event', slug: `qa-${randomUUID()}`, status: 'published', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000) });
      await assert.rejects(checkout({ ...inputs[winner], eventId: secondEvent.id }), { code: 'IDEMPOTENCY_CONFLICT' });
      await assert.rejects(checkout({ ...inputs[winner], affiliateCode: 'different-referral' }), { code: 'IDEMPOTENCY_CONFLICT' });
      assert.equal(await models.Order.count(), 1);
      await models.Order.update({ requestFingerprint: null }, { where: { id: replay.order.id } });
      assert.equal((await checkout(inputs[winner])).replayed, true); // Pre-migration saved carts remain replayable.
      await assert.rejects(checkout(inputs[1 - winner]), { code: 'IDEMPOTENCY_CONFLICT' });
    });
  } finally { await sequelize.close(); } // Runner drops only its generated database.
});
