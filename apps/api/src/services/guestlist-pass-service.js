const QRCode = require('qrcode');
const { guestlistWalletToken, guestlistPassToken } = require('../domain/wallet-qr');
const { createQrToken } = require('../domain/qr');

async function issueGuestlistPasses(models, entry, transaction) {
  return models.GuestlistPass.bulkCreate(Array.from({ length: entry.partySize }, (_, index) => ({
    guestlistEntryId: entry.id, position: index + 1, qrTokenHash: createQrToken().hash, status: 'confirmed',
  })), { transaction });
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
module.exports = { issueGuestlistPasses, guestlistPassTickets };
