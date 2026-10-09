const { mutationTransaction } = require('./mutation-transaction');
const { DomainError } = require('../domain/errors');
const { conflict } = require('../domain/errors');
const { createHash } = require('node:crypto');
const { queueEventEmail } = require('./email-events');
const { queueInstructionsSent } = require('./business-email-events');

async function sendAttendeeInstructions({ models, permissions, email, customerAppUrl, businessAppUrl = 'http://localhost:5174/', userId, eventId, instructions, idempotencyKey = null }) {
  if (!email?.enabled) throw new DomainError('Transactional email is not configured', { code: 'EMAIL_UNAVAILABLE', status: 503 });
  const digest = createHash('sha256').update(instructions).digest('hex');
  const count = await mutationTransaction(models.Event.sequelize, async (transaction) => {
    const event = await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
    await permissions.assertManageEvent(userId, eventId, transaction);
    if (!event || event.status !== 'published') throw new DomainError('Instructions require a published event', { code: 'EVENT_NOT_PUBLISHED', status: 409 });
    if (idempotencyKey) {
      await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
      const prior = await models.AuditLog.findOne({ where: { actorUserId: userId, entityType: 'Event', entityId: eventId,
        action: 'event.instructions_queued', requestId: idempotencyKey }, transaction });
      if (prior) {
        if (prior.after?.instructionDigest !== digest) throw conflict('This send request was already used with different instructions', 'INSTRUCTIONS_REQUEST_CONFLICT');
        return prior.after?.queued || 0;
      }
    }
    const audit = await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'Event', entityId: event.id,
      action: 'event.instructions_queued', requestId: idempotencyKey,
      after: { instructionLength: instructions.length, instructionDigest: digest } }, { transaction });
    const count = await queueEventEmail({ email, models, event, kind: 'instructions', variables: { INSTRUCTIONS: instructions }, customerAppUrl, transaction, key: `instructions-${audit.id}` });
    if (idempotencyKey) await audit.update({ after: { instructionLength: instructions.length, instructionDigest: digest, queued: count } }, { transaction });
    await queueInstructionsSent({ email, models, userId, event, count, actionId: audit.id, businessAppUrl, transaction });
    return count;
  });
  return { queued: count };
}

module.exports = { sendAttendeeInstructions };
