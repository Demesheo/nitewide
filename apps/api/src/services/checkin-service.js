const { hashQrToken } = require('../domain/qr');
const { verifyWalletToken, verifyGuestlistWalletToken, verifyGuestlistPassToken } = require('../domain/wallet-qr');
const { DomainError } = require('../domain/errors');
const { assertAdmissionOpen } = require('../domain/admission-policy');
const { orderAdmissionEligible } = require('../domain/order-admission-policy');
const { mutationTransaction } = require('./mutation-transaction');
const { createPermissionService } = require('./permission-service');

const invalid = () => new DomainError('This pass is invalid or belongs to another event.', { code: 'INVALID_CREDENTIAL', status: 422 });
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ticketPattern = new RegExp(`^nw1\\.(${uuidPattern})\\.[A-Za-z0-9_-]{43}$`);
const guestPattern = new RegExp(`^nwg1\\.(${uuidPattern})\\.[A-Za-z0-9_-]{43}$`);
const guestPassPattern = new RegExp(`^nwgp1\\.(${uuidPattern})\\.[A-Za-z0-9_-]{43}$`);
function createCheckInService({ sequelize, models, permissions = createPermissionService(models), tokenSecret, environment = process.env.NODE_ENV || 'development', hostedDemo = false, now = () => new Date() }) {
  return async function checkIn({ eventId, qrToken, credentialId, kind, checkedInByUserId }) {
    // A row lock under READ COMMITTED makes concurrent scans observe the first
    // admission instead of producing a serializable-transaction failure.
    return mutationTransaction(sequelize, async (transaction) => {
      const event = await models.Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
      await permissions.assertAdmitEvent(checkedInByUserId, eventId, transaction);
      const lock = transaction.LOCK.UPDATE, time = now(), manual = Boolean(credentialId);
      const hash = manual ? null : hashQrToken(qrToken);
      const walletId = !manual && ticketPattern.exec(qrToken)?.[1];
      const guestId = !manual && guestPattern.exec(qrToken)?.[1];
      const guestPassId = !manual && guestPassPattern.exec(qrToken)?.[1];
      let credential = null, parentEntry = null, offering = 'Guest list entry', resolvedKind = kind || 'ticket';
      if (guestPassId || (manual && kind === 'guestlist_pass')) {
        const peek = await models.GuestlistPass.findByPk(guestPassId || credentialId, { transaction });
        parentEntry = peek && await models.GuestlistEntry.findOne({ where: { id: peek.guestlistEntryId, eventId }, transaction, lock });
        credential = parentEntry && await models.GuestlistPass.findOne({ where: { id: peek.id, guestlistEntryId: parentEntry.id }, transaction, lock });
        if (!credential || !parentEntry.qrTokenHash || !['confirmed','checked_in'].includes(parentEntry.status) || (!manual && !verifyGuestlistPassToken(qrToken, credential, parentEntry, tokenSecret))) throw invalid();
        resolvedKind = 'guestlist_pass';
        offering = `Guest list · Spot ${credential.position} of ${parentEntry.partySize}`;
      }
      if (!credential && (!manual || kind === 'ticket') && !guestId && !guestPassId) {
        credential = await models.Ticket.findOne({ where: { eventId, ...(manual || walletId ? { id: credentialId || walletId } : { qrTokenHash: hash }) }, transaction, lock });
        if (credential) {
          resolvedKind = 'ticket';
          if (walletId && !verifyWalletToken(qrToken, credential, tokenSecret)) throw invalid();
          const item = await models.OrderItem.findByPk(credential.orderItemId, { transaction });
          const order = item && await models.Order.findByPk(item.orderId, { transaction, lock });
          offering = item?.nameSnapshot || 'Ticket';
          if (!orderAdmissionEligible(order) || (environment === 'production' && !hostedDemo && order.pricingPlanSnapshot?.demo)) throw invalid();
        }
      }
      if (!credential && (!manual || kind === 'guestlist') && !walletId) {
        credential = await models.GuestlistEntry.findOne({ where: { eventId, ...(manual || guestId ? { id: credentialId || guestId } : { qrTokenHash: hash }) }, transaction, lock });
        resolvedKind = 'guestlist';
        if (credential && guestId && (!credential.qrTokenHash || !verifyGuestlistWalletToken(qrToken, credential, tokenSecret))) throw invalid();
        if (credential && models.GuestlistPass && await models.GuestlistPass.count({ where: { guestlistEntryId: credential.id }, transaction })) throw invalid();
      }
      if (!credential) throw invalid();
      const userId = resolvedKind === 'ticket' ? credential.holderUserId : (parentEntry || credential).userId;
      const holder = userId ? await models.User.findByPk(userId, { attributes: ['displayName'], transaction }) : null;
      const safeCredential = () => ({ id: credential.id, status: credential.status, name: (parentEntry || credential).guestName || holder?.displayName || 'Guest', offering, spots: resolvedKind === 'guestlist' ? credential.partySize : 1, checkedInAt: credential.checkedInAt });
      // Verify authenticity before exposing admission history.
      if (credential.status === 'checked_in') throw new DomainError('Already admitted', { code: 'CREDENTIAL_ALREADY_USED', status: 409, details: { kind: resolvedKind, credential: safeCredential() } });
      if (credential.status !== (resolvedKind === 'ticket' ? 'valid' : 'confirmed')) throw invalid();
      assertAdmissionOpen(event, time);
      await credential.update({ status: 'checked_in', checkedInAt: time, ...(resolvedKind === 'guestlist' ? { checkedInSpots: credential.partySize } : {}) }, { transaction });
      if (parentEntry) {
        const checkedInSpots = parentEntry.checkedInSpots + 1;
        await parentEntry.update({ checkedInSpots, checkedInAt: parentEntry.checkedInAt || time,
          status: checkedInSpots === parentEntry.partySize ? 'checked_in' : 'confirmed' }, { transaction });
      }
      const checkIn = await models.CheckIn.create({ eventId, ...(resolvedKind === 'ticket' ? { ticketId: credential.id } : resolvedKind === 'guestlist_pass' ? { guestlistPassId: credential.id } : { guestlistEntryId: credential.id }), checkedInByUserId, method: manual ? 'manual' : 'qr', checkedInAt: time }, { transaction });
      return { kind: resolvedKind, credential: safeCredential(), checkIn: { id: checkIn.id, method: checkIn.method, checkedInAt: time } };
    });
  };
}
module.exports = { createCheckInService };
