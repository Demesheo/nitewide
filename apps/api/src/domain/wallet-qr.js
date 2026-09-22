const { createHmac, timingSafeEqual } = require('node:crypto');
const { getConfig } = require('../config');

// A separate signing namespace makes legacy hash-only credentials retrievable
// without storing raw secrets or rotating previously issued QR codes.
function walletToken(ticket, secret = getConfig().AUTH_TOKEN_SECRET) {
  const signature = createHmac('sha256', secret).update(`nitewide-wallet-v1:${ticket.id}:${ticket.eventId}:${ticket.holderUserId}:${ticket.qrTokenHash}`).digest('base64url');
  return `nw1.${ticket.id}.${signature}`;
}
function verifyWalletToken(token, ticket, secret) {
  const expected = Buffer.from(walletToken(ticket, secret));
  const supplied = Buffer.from(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function guestlistWalletToken(entry, secret = getConfig().AUTH_TOKEN_SECRET) {
  const signature = createHmac('sha256', secret).update(`nitewide-guestlist-wallet-v1:${entry.id}:${entry.eventId}:${entry.userId}:${entry.partySize}:${entry.qrTokenHash}`).digest('base64url');
  return `nwg1.${entry.id}.${signature}`;
}
function verifyGuestlistWalletToken(token, entry, secret) {
  const expected = Buffer.from(guestlistWalletToken(entry, secret));
  const supplied = Buffer.from(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
module.exports = { walletToken, verifyWalletToken, guestlistWalletToken, verifyGuestlistWalletToken };
