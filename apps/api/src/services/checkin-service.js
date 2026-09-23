const { Transaction } = require('sequelize');
const { hashQrToken } = require('../domain/qr');
const { verifyWalletToken, verifyGuestlistWalletToken } = require('../domain/wallet-qr');
const { notFound, conflict } = require('../domain/errors');
function createCheckInService({ sequelize, models, tokenSecret, environment = process.env.NODE_ENV || 'development', hostedDemo = false, now = () => new Date() }) {
  return async function checkIn({ eventId, qrToken, checkedInByUserId }) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const hash = hashQrToken(qrToken); const lock = transaction.LOCK.UPDATE; const time = now();
      const walletId = /^nw1\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{43}$/.exec(qrToken)?.[1];
      const ticket = await models.Ticket.findOne({ where: walletId ? { eventId, id: walletId } : { eventId, qrTokenHash: hash }, transaction, lock });
      if (ticket) {
        if (walletId && !verifyWalletToken(qrToken, ticket, tokenSecret)) throw notFound('Credential');
        if (ticket.status !== 'valid') throw conflict('Ticket has already been used or is invalid', 'CREDENTIAL_ALREADY_USED');
        const event = await models.Event.findByPk(eventId, { transaction });
        if (!event || event.status !== 'published' || new Date(event.startsAt) > time || new Date(event.endsAt) <= time) throw conflict('Admission is not open for this event', 'EVENT_NOT_OPEN');
        const item = await models.OrderItem.findByPk(ticket.orderItemId, { transaction });
        const order = item && await models.Order.findByPk(item.orderId, { transaction });
        if (!order || order.status !== 'paid' || (environment === 'production' && !hostedDemo && order.pricingPlanSnapshot?.demo)) throw conflict('This order is not valid for admission', 'ORDER_NOT_VALID');
        await ticket.update({ status: 'checked_in', checkedInAt: time }, { transaction });
        const checkIn = await models.CheckIn.create({ eventId, ticketId: ticket.id, checkedInByUserId, method: 'qr', checkedInAt: time }, { transaction });
        return { kind: 'ticket', credential: ticket, checkIn };
      }
      const guestlistWalletId = /^nwg1\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{43}$/.exec(qrToken)?.[1];
      const entry = await models.GuestlistEntry.findOne({ where: guestlistWalletId ? { eventId, id: guestlistWalletId } : { eventId, qrTokenHash: hash }, transaction, lock });
      if (!entry) throw notFound('Credential');
      if (guestlistWalletId && (!entry.qrTokenHash || !verifyGuestlistWalletToken(qrToken, entry, tokenSecret))) throw notFound('Credential');
      if (entry.status !== 'confirmed') throw conflict('Guestlist credential has already been used or is invalid', 'CREDENTIAL_ALREADY_USED');
      const event = await models.Event.findByPk(eventId, { transaction });
      if (!event) throw notFound('Event');
      if (new Date(event.startsAt) > time) throw conflict('Guestlist check-in is not open before the event starts', 'EVENT_NOT_STARTED');
      if (event.status !== 'published' || new Date(event.endsAt) <= time) throw conflict('Admission is not open for this event', 'EVENT_NOT_OPEN');
      await entry.update({ status: 'checked_in', checkedInAt: time }, { transaction });
      const checkIn = await models.CheckIn.create({ eventId, guestlistEntryId: entry.id, checkedInByUserId, method: 'qr', checkedInAt: time }, { transaction });
      return { kind: 'guestlist', credential: entry, checkIn };
    });
  };
}
module.exports = { createCheckInService };
