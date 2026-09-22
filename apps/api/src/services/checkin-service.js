const { Transaction } = require('sequelize');
const { hashQrToken } = require('../domain/qr');
const { notFound, conflict } = require('../domain/errors');
function createCheckInService({ sequelize, models, now = () => new Date() }) {
  return async function checkIn({ eventId, qrToken, checkedInByUserId }) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const hash = hashQrToken(qrToken); const lock = transaction.LOCK.UPDATE; const time = now();
      const ticket = await models.Ticket.findOne({ where: { eventId, qrTokenHash: hash }, transaction, lock });
      if (ticket) {
        if (ticket.status !== 'valid') throw conflict('Ticket has already been used or is invalid', 'CREDENTIAL_ALREADY_USED');
        await ticket.update({ status: 'checked_in', checkedInAt: time }, { transaction });
        const checkIn = await models.CheckIn.create({ eventId, ticketId: ticket.id, checkedInByUserId, method: 'qr', checkedInAt: time }, { transaction });
        return { kind: 'ticket', credential: ticket, checkIn };
      }
      const entry = await models.GuestlistEntry.findOne({ where: { eventId, qrTokenHash: hash }, transaction, lock });
      if (!entry) throw notFound('Credential');
      if (entry.status !== 'confirmed') throw conflict('Guestlist credential has already been used or is invalid', 'CREDENTIAL_ALREADY_USED');
      const event = await models.Event.findByPk(eventId, { transaction });
      if (!event) throw notFound('Event');
      if (new Date(event.startsAt) > time) throw conflict('Guestlist check-in is not open before the event starts', 'EVENT_NOT_STARTED');
      await entry.update({ status: 'checked_in', checkedInAt: time }, { transaction });
      const checkIn = await models.CheckIn.create({ eventId, guestlistEntryId: entry.id, checkedInByUserId, method: 'qr', checkedInAt: time }, { transaction });
      return { kind: 'guestlist', credential: entry, checkIn };
    });
  };
}
module.exports = { createCheckInService };
