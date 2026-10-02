const QRCode = require('qrcode');
const { guestlistWalletToken, guestlistPassToken } = require('../domain/wallet-qr');
const { createQrToken } = require('../domain/qr');
const { conflict } = require('../domain/errors');

const passData = (entry, position) => ({ guestlistEntryId: entry.id, position, qrTokenHash: createQrToken().hash, status: 'confirmed' });

async function issueGuestlistPasses(models, entry, transaction) {
  return models.GuestlistPass.bulkCreate(Array.from({ length: entry.partySize }, (_, index) => passData(entry, index + 1)), { transaction });
}
async function reconcileGuestlistPasses(models, entry, transaction) {
  const passes = await models.GuestlistPass.findAll({ where: { guestlistEntryId: entry.id }, transaction, lock: transaction.LOCK.UPDATE });
  if (passes.some((pass) => pass.checkedInAt || pass.status === 'checked_in')) {
    throw conflict('An admitted guestlist entry cannot be approved again', 'GUESTLIST_ALREADY_REVIEWED');
  }
  // Retain unused passes at existing positions when restoring an approval.
  // The updated parent credential invalidates every previously issued QR code.
  for (const pass of passes.filter((pass) => pass.position > entry.partySize)) await pass.destroy({ transaction });
  const positions = new Set(passes.map((pass) => pass.position));
  const missing = Array.from({ length: entry.partySize }, (_, index) => index + 1).filter((position) => !positions.has(position));
  if (missing.length) await models.GuestlistPass.bulkCreate(missing.map((position) => passData(entry, position)), { transaction });
}
async function guestlistPassTickets(models, entry, secret, available) {
  const passes = models.GuestlistPass ? await models.GuestlistPass.findAll({ where: { guestlistEntryId: entry.id }, order: [['position','ASC']] }) : [];
  const image = token => QRCode.toDataURL(token, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
  if (!passes.length) return [{ id: entry.id, offering: 'Guest list entry', status: entry.status, spots: entry.partySize,
    checkedInAt: entry.checkedInAt, qrImage: available ? await image(guestlistWalletToken(entry, secret)) : null }];
  return Promise.all(passes.map(async pass => ({ id: pass.id, offering: `Guest list · Spot ${pass.position} of ${entry.partySize}`,
    status: ['confirmed','checked_in'].includes(entry.status) ? pass.status : entry.status, spots: 1,
    checkedInAt: pass.checkedInAt, qrImage: available ? await image(guestlistPassToken(pass, entry, secret)) : null })));
}
module.exports = { issueGuestlistPasses, reconcileGuestlistPasses, guestlistPassTickets };
