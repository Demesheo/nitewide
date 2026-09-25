const { Transaction } = require('sequelize');
const { hashQrToken } = require('../domain/qr');
const { verifyWalletToken, verifyGuestlistWalletToken } = require('../domain/wallet-qr');
const { DomainError } = require('../domain/errors');
const { assertAdmissionOpen } = require('../domain/admission-policy');

const invalid = () => new DomainError('This pass is invalid or belongs to another event.', { code: 'INVALID_CREDENTIAL', status: 422 });
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ticketPattern = new RegExp(`^nw1\\.(${uuidPattern})\\.[A-Za-z0-9_-]{43}$`);
const guestPattern = new RegExp(`^nwg1\\.(${uuidPattern})\\.[A-Za-z0-9_-]{43}$`);
function createCheckInService({ sequelize, models, tokenSecret, environment = process.env.NODE_ENV || 'development', hostedDemo = false, now = () => new Date() }) {
  return async function checkIn({ eventId, qrToken, credentialId, kind, checkedInByUserId }) {
    // A row lock under READ COMMITTED makes concurrent scans observe the first
    // admission instead of producing a serializable-transaction failure.
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
      const lock = transaction.LOCK.UPDATE, time = now(), manual = Boolean(credentialId);
      const hash = manual ? null : hashQrToken(qrToken);
      const walletId = !manual && ticketPattern.exec(qrToken)?.[1];
      const guestId = !manual && guestPattern.exec(qrToken)?.[1];
      let credential = null, offering = 'Guest list entry', resolvedKind = kind || 'ticket';
      if ((!manual || kind === 'ticket') && !guestId) {
        credential = await models.Ticket.findOne({ where: { eventId, ...(manual || walletId ? { id: credentialId || walletId } : { qrTokenHash: hash }) }, transaction, lock });
        if (credential) {
          resolvedKind = 'ticket';
          if (walletId && !verifyWalletToken(qrToken, credential, tokenSecret)) throw invalid();
          const item = await models.OrderItem.findByPk(credential.orderItemId, { transaction });
          const order = item && await models.Order.findByPk(item.orderId, { transaction, lock });
          offering = item?.nameSnapshot || 'Ticket';
          if (!order || order.status !== 'paid' || (environment === 'production' && !hostedDemo && order.pricingPlanSnapshot?.demo)) throw invalid();
        }
      }
      if (!credential && (!manual || kind === 'guestlist') && !walletId) {
        credential = await models.GuestlistEntry.findOne({ where: { eventId, ...(manual || guestId ? { id: credentialId || guestId } : { qrTokenHash: hash }) }, transaction, lock });
        resolvedKind = 'guestlist';
        if (credential && guestId && (!credential.qrTokenHash || !verifyGuestlistWalletToken(qrToken, credential, tokenSecret))) throw invalid();
      }
      if (!credential) throw invalid();
      const holder = await models.User.findByPk(resolvedKind === 'ticket' ? credential.holderUserId : credential.userId, { attributes: ['displayName'], transaction });
      const safeCredential = () => ({ id: credential.id, status: credential.status, name: holder?.displayName || 'Guest', offering, spots: resolvedKind === 'ticket' ? 1 : credential.partySize, checkedInAt: credential.checkedInAt });
      // Verify authenticity before exposing admission history.
      if (credential.status === 'checked_in') throw new DomainError('Already admitted', { code: 'CREDENTIAL_ALREADY_USED', status: 409, details: { kind: resolvedKind, credential: safeCredential() } });
      if (credential.status !== (resolvedKind === 'ticket' ? 'valid' : 'confirmed')) throw invalid();
      const event = await models.Event.findByPk(eventId, { transaction });
      assertAdmissionOpen(event, time);
      await credential.update({ status: 'checked_in', checkedInAt: time }, { transaction });
      const checkIn = await models.CheckIn.create({ eventId, ...(resolvedKind === 'ticket' ? { ticketId: credential.id } : { guestlistEntryId: credential.id }), checkedInByUserId, method: manual ? 'manual' : 'qr', checkedInAt: time }, { transaction });
      return { kind: resolvedKind, credential: safeCredential(), checkIn: { id: checkIn.id, method: checkIn.method, checkedInAt: time } };
    });
  };
}
module.exports = { createCheckInService };
