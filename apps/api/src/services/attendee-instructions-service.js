const { DomainError } = require('../domain/errors');
const { queueEventEmail } = require('./email-events');
const { queueInstructionsSent } = require('./business-email-events');

async function sendAttendeeInstructions({ models, permissions, email, customerAppUrl, businessAppUrl = 'http://localhost:5174/app', userId, eventId, instructions }) {
  await permissions.assertManageEvent(userId, eventId);
  if (!email?.enabled) throw new DomainError('Transactional email is not configured', { code: 'EMAIL_UNAVAILABLE', status: 503 });
  const event = await models.Event.findByPk(eventId);
  if (!event || event.status !== 'published') throw new DomainError('Instructions require a published event', { code: 'EVENT_NOT_PUBLISHED', status: 409 });
  const count = await models.Event.sequelize.transaction(async (transaction) => {
    const audit = await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'Event', entityId: event.id, action: 'event.instructions_queued', after: { instructionLength: instructions.length } }, { transaction });
    const count = await queueEventEmail({ email, models, event, kind: 'instructions', variables: { INSTRUCTIONS: instructions }, customerAppUrl, transaction, key: `instructions-${audit.id}` });
    await queueInstructionsSent({ email, models, userId, event, count, actionId: audit.id, businessAppUrl, transaction });
    return count;
  });
  return { queued: count };
}

module.exports = { sendAttendeeInstructions };
